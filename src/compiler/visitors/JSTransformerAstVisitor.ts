import * as ast from "../ast";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { Context, LogLevel } from "../Context";
import { ScopeType } from "../SymbolTable";
import { SourceNode } from "source-map";
import { 
  createSourceNode, 
  joinArray, 
  formatVariable, 
  formatFunction, 
  isStandardLibReference, 
} from "./helpers";
import { uniqueIdentifier } from "../utils/uniqueIdentifier";
import { encodeIdentifier } from "../utils/encodeIdentifier";
import path from "path";

/**
 * Helper to extract variable names declared within a pattern match
 */
function findIdentifiersToDefine(node: ast.MatchNode): string[] {
  const predefinedVariables: string[] = [];
  const walkPattern = (p: ast.PatternNode): boolean => {
    switch (p._type) {
      case "identifier-pattern":
        const id = encodeIdentifier(p.id.id);
        if (!isStandardLibReference(id)) {
          predefinedVariables.push(id);
        }
        return true;
      case "map-pattern":
        return (p as ast.MapPatternNode).pairs.every(x => walkPattern(x.pattern));
      case "list-pattern":
      case "vector-pattern":
        return (p as ast.ListPatternNode).elements.every(x => walkPattern(x));
      default:
        return true;
    }
  };
  node.cases.every(x => walkPattern(x.pattern));
  return Array.from(new Set(predefinedVariables));
}

export class ClassBuilder {
  private name: SourceNode;
  private node: ast.ClassNode;
  
  private accessModifiers: (SourceNode | string)[] = [];
  private extendsClause: (SourceNode | string)[] = [];
  private implementsClause: (SourceNode | string)[] = [];
  private ctorVars: ast.VariableNode[] = [];
  private classFields: ast.VariableNode[] = [];
  private methods: ast.FunctionNode[] = [];
  private otherBody: ast.ASTNode[] = [];

  private context: Context;
  private visitor: JSTransformerAstVisitor;

  constructor(
    node: ast.ClassNode,
    context: Context,
    visitor: JSTransformerAstVisitor
  ) {
    this.context = context;
    this.visitor = visitor;
    this.node = node;
    this.name = createSourceNode(node.name, node.name.name);

    this.processExtends(node);
    this.processImplements(node);
    this.processBody(node.body);
  }

  private processExtends(node: ast.ClassNode): void {
    if (node.extends && node.extends.length > 0) {
      const parentClass = node.extends[0]; 
      this.extendsClause = [
        ` extends `,
        createSourceNode(parentClass, parentClass.type.name)
      ];
    }
  }

  private processImplements(node: ast.ClassNode): void {
    if (node.implements && node.implements.length > 0) {
      this.implementsClause = [
        ` /* implements `,
        ...joinArray(node.implements.map((x) => this.visitor.visit(x)), ", "),
        ` */`
      ];
    }
  }

  private processBody(body: any[]): void {
    const nodes = body.map((x: any) => x.nodes ? x.nodes : [x]).flat(2);

    for (let b of nodes) {
      if (b._type === "variable") {
        this.processVariable(b);
      } else if (b._type === "function") {
        this.methods.push(b);
      } else {
        this.otherBody.push(b);
      }
    }
  }

  private processVariable(variable: ast.VariableNode): void {
    const fieldModifiers = variable.modifiers.map((m) => m.modifier);
    if (fieldModifiers.includes("ctor")) {
      this.ctorVars.push(variable);
    } else {
      this.classFields.push(variable);
    }
  }

  private buildConstructor(): (SourceNode | string)[] {
    if (this.ctorVars.length === 0) return [];

    const ctorParams = this.ctorVars.map((v) => this.visitor.visit(v.name));
    const assignments = this.ctorVars.map((v) => {
      const fieldName = this.visitor.visit(v.name);
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");
      const targetField = isPrivate ? ["#", fieldName] : [fieldName];
      return createSourceNode(v, "this.", ...targetField, " = ", fieldName);
    });

    const superCall = (this.node.extends && this.node.extends.length > 0) 
      ? ["super(); // Implicit super call\n"] 
      : [];

    return [
      `constructor(`, ...joinArray(ctorParams, ", "), `) {`,
      ...superCall,
      ...joinArray(assignments, ";"),
      `}`
    ];
  }

  private buildFields(): (SourceNode | string)[] {
    return this.classFields.flatMap((v) => {
      const result: (SourceNode | string)[] = [];
      const isPrivate = v.modifiers.some((x) => x.modifier === "private");

      if (isPrivate) result.push('#');
      result.push(this.visitor.visit(v.name));

      if (v.value) {
        result.push(' = ');
        result.push(this.visitor.visit(v.value));
      }
      result.push(';');
      return result;
    });
  }

  private buildMethods(): (SourceNode | string)[] {
    // Methods in JS classes must look like `name(args) {}` not `const name = ...`
    // We rely on the visitor knowing it's in a Class Scope to formatting correctly
    return this.methods.map(m => this.visitor.visit(m));
  }

  private buildOtherBody(): (SourceNode | string)[] {
    return this.otherBody.map((b) => this.visitor.visit(b));
  }

  public build(): SourceNode {
    return createSourceNode(this.node,
      ...this.accessModifiers,
      'class ', this.name,
      ...this.extendsClause,
      ...this.implementsClause,
      ' {\n',
      ...this.buildFields(), '\n',
      ...this.buildConstructor(), '\n',
      ...this.buildMethods(), '\n',
      ...this.buildOtherBody(), '\n}'
    );
  }
}

export class JSTransformerAstVisitor extends BaseAstVisitor {
  private scope: ScopeType[] = [ScopeType.program];
  
  public functions: string[] = [];
  public classes: string[] = [];
  public variables: string[] = [];

  private identifiers: Record<string, string> = {};
  private inlineStandardSymbols: string[] = [];

  constructor(context: Context) {
    super(context);
  }

  // =========================================================================
  // Scope Helpers
  // =========================================================================

  private pushScope(nextScope: ScopeType) {
    this.scope.unshift(nextScope);
  }

  private popScope() {
    return this.scope.shift();
  }

  private currentScope(): ScopeType {
    return this.scope.at(0)!;
  }

  private inScope(...scopes: ScopeType[]) {
    return scopes.includes(this.currentScope());
  }

  /**
   * Determines if the current location requires an Expression (value) 
   * or accepts a Statement (void/action).
   * 
   * Expression contexts: variable assignments, and nested expressions.
   * Statement contexts: function bodies, if bodies at statement level, etc.
   */
  private isExpressionContext(): boolean {
    // Treat these parent scopes as expression contexts so nested
    // constructs (like `if` inside a `match` arm or `when` value)
    // emit expression-style code (ternaries / comma-exprs) instead
    // of statement-style `if { ... }` blocks.
    return this.scope.some(
      (s) => s === ScopeType.variable || s === ScopeType.match
    );
  }

  private runInScope<T>(scope: ScopeType, action: () => T): T {
    this.pushScope(scope);
    try {
      return action();
    } finally {
      this.popScope();
    }
  }

  // =========================================================================
  // Core
  // =========================================================================

  private inlineStandardLibrary(): string {
    return ""; 
  }

  public compile(root: ast.ASTNode) {
    const rootSourceNode = this.visit(root);
    
    const header = [
      `// Module: ${this.context.mainModule}\n`,
      `// Compiled at: ${new Date().toISOString()}\n`,
      `"use strict";\n\n`
    ];

    const standardLibrary = createSourceNode(root, this.inlineStandardLibrary());
    const sourceName = root && root._location && root._location.source ? root._location.source : 'bundle.lisp';
    const sourceMapUrl = `\n\n//# sourceMappingURL=${path.basename(sourceName, '.lisp')}.js.map`;

    const wrappedBody = createSourceNode(root, '(function() {', '\n', rootSourceNode, '\n', '})()');

    return createSourceNode(root,
      ...header,
      standardLibrary,
      wrappedBody,
      sourceMapUrl
    ).toStringWithSourceMap();
  }

  visitProgram(node: ast.ProgramNode) {
    // Top level program is a list of statements, joined by semicolons
    // Prefix with an empty statement to avoid accidental string-call when
    // the first statement is an expression starting with `(`.
    return createSourceNode(node, 
      ";\n",
      ...joinArray(node.program.map(n => this.visit(n)), ';\n')
    );
  }

  // =========================================================================
  // Classes
  // =========================================================================

  visitClass(node: ast.ClassNode) {
    return this.runInScope(ScopeType.class, () => {
      const classBuilder = new ClassBuilder(node, this.context, this);
      const result = classBuilder.build();
      this.classes.push(node.name.name);
      return result;
    });
  }

  visitInterface(node: ast.InterfaceNode) {
    return this.runInScope(ScopeType.interface, () => {
      const name = this.visit(node.name);
      return createSourceNode(node, `/* interface ${name} (erased) */`);
    });
  }

  // =========================================================================
  // Functions & Variables
  // =========================================================================

  visitFunction(node: ast.FunctionNode) {
    const nextScope = this.inScope(ScopeType.class) 
      ? ScopeType.method 
      : ScopeType.function;

    return this.runInScope(nextScope, () => {
      const name = node.name && this.visit(node.name);
      const params = node.params.map((x) => this.visit(x));
      
      // Function Body Processing
      const bodyNodes = node.body.map((x) => this.visit(x));
      let body: (SourceNode | string)[];

      if (bodyNodes.length === 0) {
        body = [];
      } else {
        body = joinArray(bodyNodes, ";");
      }

      // Determine the appropriate function format based on parent scope (before we pushed nextScope)
      const parentScope = this.scope[1]; // scope[0] is the nextScope we just pushed
      
      if (this.currentScope() === ScopeType.method) {
        // Method: name(params) { body }
        return createSourceNode(node,
            node.async ? "async " : "",
            name, "(", ...joinArray(params, ","), ") {",
            ...body,
            "}"
        );
      } else if (parentScope === ScopeType.program) {
        // Top-level function: function name(params) { body }
        return createSourceNode(node,
            node.async ? "async " : "",
            "function ", name, "(", ...joinArray(params, ","), ") {",
            ...body,
            "}"
        );
      } else {
        // Nested function: const name = (params) => { body }
        const kw = node.async ? "async " : "";
        const arrow = [kw, "(", ...joinArray(params, ","), ") => {", ...body, "}"];
        
        if (name) {
            this.functions.push(name.toString());
            return createSourceNode(node, "const ", name, " = ", ...arrow);
        } else {
            return createSourceNode(node, ...arrow);
        }
      }
    });
  }

  visitVariable(node: ast.VariableNode) {
    this.pushScope(ScopeType.variable);
    const name = this.visit(node.name);
    const value = node.value ? this.visit(node.value) : undefined;
    this.popScope();

    this.variables.push(name.toString());

    return createSourceNode(node,
      formatVariable(
        this.currentScope(),
        node,
        node.mutable,
        name,
        value,
        this.context
      ));
  }

  visitParameter(node: ast.ParameterNode) {
    return this.visit(node.name);
  }

  // =========================================================================
  // Control Flow
  // =========================================================================

  visitIf(node: ast.IfNode) {
    return this.runInScope(ScopeType.if, () => {
      const condition = this.visit(node.condition!);
      const thenExpr = this.visit(node.then!);
      const elseExpr = node.else ? this.visit(node.else) : undefined;

      // If we are in an expression context (assignment, args), use Ternary
      if (this.isExpressionContext()) {
         return createSourceNode(node, 
            "(", condition, ") ? (", thenExpr, ") : (", elseExpr || "undefined", ")"
         );
      }

      // Statement context
      const elseBlock = elseExpr ? [" else { ", elseExpr, " }"] : [];
      return createSourceNode(node, 
        "if (", condition, ") { ", thenExpr, " }", ...elseBlock
      );
    });
  }

  visitWhen(node: ast.WhenNode) {
    return this.runInScope(ScopeType.when, () => {
      const condition = this.visit(node.condition!);
      const whenExprs = node.then!.map((x) => this.visit(x));
      const body = joinArray(whenExprs, ";");

      if (this.isExpressionContext()) {
        // (cond) ? (exprs) : undefined
        // Note: JS comma operator (a, b) returns b.
        return createSourceNode(node, 
            "(", condition, ") ? (", ...joinArray(whenExprs, ","), ") : undefined"
        );
      }

      return createSourceNode(node, "if (", condition, ") { ", ...body, " }");
    });
  }

  visitWhile(node: ast.WhileNode) {
    const condition = this.visit(node.condition);
    const body = this.visit(node.then);
    return createSourceNode(node, `while (`, condition, `) {`, body, `}`);
  }

  visitTryCatch(node: ast.TryCatchNode) {
    const tryBlock = [ `try {`, this.visit(node.try), `}` ];
    const catchVar = uniqueIdentifier(); 
    
    const catchBlocks = node.catch?.filter(x => !!x.filter)?.map(x => {
      const catchFilterVar = this.visit(x.filter.name);
      const catchFilterType = this.visit(x.filter.type);
      const catchBody = this.visit(x.body);
      
      // We need to declare the filtered var: const err = catchVar;
      return [
        `if (`, catchVar, ` instanceof `, catchFilterType, `) {`,
        `const `, catchFilterVar, ` = `, catchVar, `;`, 
        catchBody, 
        `}`
      ];
    });

    const defaultCatchNode = node.catch?.find(x => !x.filter);
    const defaultCatchBlock = defaultCatchNode 
      ? this.visit(defaultCatchNode.body) 
      : [`throw `, catchVar, `;`];

    const joinedCatchBody = catchBlocks && catchBlocks.length > 0
        ? [...joinArray(catchBlocks, ' else '), ' else { ', defaultCatchBlock, ' }']
        : defaultCatchBlock;

    const catchBlock = node.catch 
      ? [` catch (`, catchVar, `) {`, ...joinedCatchBody, `}`] 
      : [];
      
    const finallyBlock = node.finally 
      ? [` finally {`, this.visit(node.finally), `}`] 
      : [];

    return createSourceNode(node, ...tryBlock, ...catchBlock, ...finallyBlock);
  }

  // =========================================================================
  // Pattern Matching
  // =========================================================================

  visitMatch(node: ast.MatchNode) {
    return this.runInScope(ScopeType.match, () => {
      const matchVar = uniqueIdentifier();
      const matchVal = this.visit(node.expression);

      const matchCases = node.cases.map((x) => ({
        p: x.pattern,
        b: this.visit(x.body),
      }));

      const ifExprs = matchCases.map((x) => {
        const condition = this.generateCondition(x.p, matchVar);
        return createSourceNode(x.p, '(', condition, ')', '?', '(', x.b, ')');
      });

      const predefinedVariables = findIdentifiersToDefine(node);
      const predefinedVarsCode = predefinedVariables.length > 0
        ? `let ${predefinedVariables.join(',')};`
        : '';

      return createSourceNode(node, 
        `((`, matchVar, `) => { `, 
        predefinedVarsCode, 
        'return ', ...joinArray(ifExprs, ' : '), ' : undefined;', 
        '})(', matchVal, `)`
      );
    });
  }

  private generateCondition(pattern: ast.PatternNode, matchVar: string): SourceNode {
    switch (pattern._type) {
      case "any-pattern": return createSourceNode(pattern, `true`);
      case "identifier-pattern": 
        return createSourceNode(pattern, `(`, this.visit(pattern.id), '=', matchVar, `, true)`);
      case "constant-pattern":
        return createSourceNode(pattern, matchVar, ' === ', this.visit(pattern.constant));
      case "list-pattern":
      case "vector-pattern":
        return this.generateArrayPatternCondition(pattern as ast.ListPatternNode, matchVar);
      case "map-pattern":
        return this.generateMapPatternCondition(pattern as ast.MapPatternNode, matchVar);
      default:
        return createSourceNode(pattern, `false`);
    }
  }

  private generateArrayPatternCondition(pattern: ast.ListPatternNode | ast.VectorPatternNode, matchVar: string): SourceNode {
    const conditions: (string | SourceNode)[] = [];
    conditions.push(`Array.isArray(${matchVar})`);
    conditions.push(`${matchVar}.length === ${pattern.elements.length}`);
    pattern.elements.forEach((elem, idx) => {
      conditions.push(this.generateCondition(elem, `${matchVar}[${idx}]`));
    });
    return createSourceNode(pattern, ...joinArray(conditions, " && "));
  }

  private generateMapPatternCondition(pattern: ast.MapPatternNode, matchVar: string): SourceNode {
    const conditions: (string | SourceNode)[] = [];
    conditions.push(`(typeof ${matchVar} === 'object' && ${matchVar} !== null)`);
    pattern.pairs.forEach((pair) => {
      const keyRaw = pair.key._type === 'string' ? pair.key.value : null;
      if (keyRaw) conditions.push(`'${keyRaw}' in ${matchVar}`);
      conditions.push(this.generateCondition(pair.pattern, `${matchVar}[${this.visit(pair.key)}]`));
    });
    return createSourceNode(pattern, ...joinArray(conditions, " && "));
  }

  // =========================================================================
  // Identifiers / Literals
  // =========================================================================

  visitIdentifier(node: ast.IdentifierNode) {
    if (this.identifiers[node.id]) return createSourceNode(node, this.identifiers[node.id]);
    const id = encodeIdentifier(node.id);
    this.identifiers[node.id] = id;
    if (isStandardLibReference(id)) this.inlineStandardSymbols.push(id);
    return createSourceNode(node, id);
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode) { return this.visitIdentifier(node); }
  visitCompositeIdentifier(node: ast.CompositeIdentifierNode) { return this.visitIdentifier(node); }

  visitString(node: ast.StringNode) { return createSourceNode(node, `"`, node.value, `"`); }
  visitBoolean(node: ast.BooleanNode) { return createSourceNode(node, node.value.toString()); }
  visitIntegerNumber(node: ast.IntegerNumberNode) { return createSourceNode(node, node.value.toString()); }
  visitFloatNumber(node: ast.FloatNumberNode) { return createSourceNode(node, node.value.toString()); }

  visitFormattedString(node: ast.FormattedStringNode) {
    const value = node.value.map((x) =>
      x._type === "string" ? x.value : this.visit(x)
    );
    return createSourceNode(node, "`", ...value, "`");
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    return createSourceNode(node, "${formatObjectToString(", this.visit(node.expression), ")}");
  }

  // =========================================================================
  // Lists (The Core Logic)
  // =========================================================================

  visitList(node: ast.ListNode) {
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    if (nodes.length === 0) return createSourceNode(node, "null");

    const [head, ...rest] = nodes;
    
    // Check if head is an identifier (Function Call? Class Instantiation?)
    const isHeadIdentifier = head._type === "simple-identifier" || head._type === "composite-identifier";

    if (isHeadIdentifier) {
        // Special case: single-element list with just an identifier is a grouping, not a call
        if (rest.length === 0) {
            return this.visit(head);
        }

        const callee = this.visit(head);
        const args = rest.map(x => this.visit(x));
        const calleeStr = callee.toString();

        if (this.classes.includes(calleeStr)) {
            return createSourceNode(node, 'new ', callee, '(', ...joinArray(args, ","), ')');
        }

        // It is a function call
        return createSourceNode(node, callee, '(', ...joinArray(args, ","), ')');
    }

    // Implicit Block / Sequence
    // Example: ( (let x 1) (print x) )
    // Head is NOT an identifier (e.g., it is a let-statement or another list)
    
    const statements = nodes.map(x => this.visit(x));

    if (this.isExpressionContext()) {
        // We are inside an expression (e.g., argument list), but we have a block of statements.
        // Wrap in IIFE: (() => { stmt; stmt; return last; })()
        const last = statements[statements.length - 1];
        const body = statements.slice(0, -1).map(s => [s, ';']);
        
        return createSourceNode(node, 
            "(() => { ", ...body.flat(), " return ", last, "; })()"
        );
    } else {
        // Just a block of statements
        return createSourceNode(node, ...joinArray(statements, ";"));
    }
  }

  // =========================================================================
  // Misc
  // =========================================================================

  visitVector(node: ast.VectorNode) {
    return createSourceNode(node, '[', ...joinArray(node.values.map(x => this.visit(x)), ","), ']');
  }

  visitMap(node: ast.MapNode) {
    return createSourceNode(node, '{', ...joinArray(node.values.map(x => this.visit(x)), ","), '}');
  }

  visitKeyValue(node: ast.KeyValueNode) {
    return createSourceNode(node, this.visit(node.key), ': ', this.visit(node.value));
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode) {
    return createSourceNode(node, this.visit(node.assignable), ` = `, this.visit(node.value));
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode) {
    const assignable = this.visit(node.assignable);
    const value = this.visit(node.value);
    return createSourceNode(node, assignable, ` = `, value, `/* Compound assignment '${node.operator}=' */`);
  }

  visitIndexer(node: ast.IndexerNode) {
    const id = this.visit(node.id);
    const indices = node.indices.flatMap(x => [ '[', ...x.map(y => this.visit(y)), ']' ]);
    return createSourceNode(node, id, ...indices);
  }

  visitAwait(node: ast.AwaitNode) {
    return createSourceNode(node, `await `, this.visit(node.expression));
  }
  
  visitControlComment(node: ast.ControlCommentNode) { return createSourceNode(node, ""); }
  visitComment(node: ast.CommentNode) { return createSourceNode(node, `// ${node.comment}\n`); }
  
  // Handling serialization of quotes for macros/AST access at runtime
  visitQuote(node: ast.QuoteNode) {
    if (node.mode !== "default") return createSourceNode(node, "null");
    const serialized = JSON.stringify(node, (key, val) => 
      ["_location", "_parent"].includes(key) ? undefined : val
    );
    return createSourceNode(node, serialized);
  }
}
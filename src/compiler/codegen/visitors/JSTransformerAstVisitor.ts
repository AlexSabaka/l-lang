import * as ast from "../../frontend/ast";
import { BaseAstVisitor } from "../../BaseAstVisitor";
import { Context, LogLevel } from "../../Context";
import { ScopeType, SymbolEntry } from "../../analysis/SymbolTable";
import { SourceNode } from "source-map";
import { 
  createSourceNode, 
  joinArray, 
  formatVariable, 
  formatFunction, 
  isStandardLibReference, 
} from "../../helpers/utils/helpers";
import { uniqueIdentifier } from "../../helpers/utils/uniqueIdentifier";
import { encodeIdentifier } from "../../helpers/utils/encodeIdentifier";
import { ClassBuilder } from "../ClassBuilder";
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
/**
 * Helper to extract ctor variable names from ANY class node
 * (Used for both the current class and looking up the parent class)
 */
function getCtorParamsFromClassNode(node: ast.ClassNode): string[] {
  // L-lang AST bodies can be nested arrays of lists/statements, flatten them 2 levels deep
  // to find the actual VariableNodes.
  const bodyNodes = node.body.map((x: any) => x.nodes ? x.nodes : [x]).flat(2);

  return bodyNodes
    .filter((n: any) => n._type === "variable")
    .map((n: ast.VariableNode) => n)
    .filter((v) => v.modifiers.some((m) => m.modifier === "ctor"))
    .map((v) => (v.name as any).id ?? (v.name as any).name);
}

export class JSTransformerAstVisitor extends BaseAstVisitor {
  private scope: ScopeType[] = [ScopeType.program];
  
  public functions: string[] = [];
  public classes: string[] = [];
  public variables: string[] = [];

  private identifiers: Record<string, string> = {};
  private inlineStandardSymbols: string[] = [];
  // Symbols that were inlined from imported modules
  private inlinedSymbols: Record<string, string> = {};
  // Definitions (SourceNode or string parts) keyed by unique name
  private inlinedDefinitions: Record<string, (SourceNode | string)[]> = {};
  // Source file for the AST root currently being compiled
  private rootSource?: string;

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
    // Remember the root source so we can detect imports vs local symbols
    this.rootSource = root && root._location && root._location.source ? root._location.source : undefined;
    const rootSourceNode = this.visit(root);
    
    const header = [
      `// Module: ${this.context.mainModule}\n`,
      `// Compiled at: ${new Date().toISOString()}\n`,
      `"use strict";\n\n`
    ];

    const standardLibrary = createSourceNode(root, this.inlineStandardLibrary());
    const sourceName = root && root._location && root._location.source ? root._location.source : 'bundle.lisp';
    const sourceMapUrl = `\n\n//# sourceMappingURL=${path.basename(sourceName, '.lisp')}.js.map`;

    // Prepend any inlined definitions collected during traversal
    // console.log('inlinedDefinitions keys:', Object.keys(this.inlinedDefinitions));
    const defs = Object.values(this.inlinedDefinitions).flat();
    const defsWithSeparators = defs.length > 0 ? joinArray(defs, ';\n') : [];
    const wrappedBody = createSourceNode(root, '(function() {', '\n', ...defsWithSeparators, defs.length > 0 ? ';\n' : '', rootSourceNode, '\n', '})()');

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
    this.classes.push(node.name.name);

    return this.runInScope(ScopeType.class, () => {
      const classBuilder = new ClassBuilder(node, this.context, this);
      return classBuilder.build();
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
      if (name) {
          this.functions.push(name.toString());
      }

      const params = node.params.map((x) => this.visit(x));
      
      // Function Body Processing
      const bodyNodes = node.body.map((x, index) => {
        const visited = this.visit(x);
        
        // Implicit Return Logic
        if (index === node.body.length - 1) {
            
            // 1. Convert to string to check what we actually generated
            const visitedCode = visited.toString().trim();

            // 2. Check strict exclusions
            // - If it's already a return statement (Explicit return)
            // - If it starts with 'if', 'while', 'try', 'for' (Statements that can't be returned)
            // - If it's a variable declaration (const/let)
            
            const isAlreadyReturn = visitedCode.startsWith("return");
            const isControlStatement = visitedCode.startsWith("if") || 
                                       visitedCode.startsWith("while") ||
                                       visitedCode.startsWith("try") ||
                                       visitedCode.startsWith("for");
            const isVariable = x._type === 'variable';

            if (!isAlreadyReturn && !isControlStatement && !isVariable) {
                return createSourceNode(x, "return ", visited);
            }
        }
        
        return visited;
      });

      // ... rest of the existing logic (joining body, wrapping in function/method/arrow) ...
      let body: (SourceNode | string)[];

      if (bodyNodes.length === 0) {
        body = [];
      } else {
        body = joinArray(bodyNodes, ";");
      }

      // ... (keep the existing function signature generation logic) ...
      const parentScope = this.scope[1]; 
      
      if (this.currentScope() === ScopeType.method) {
        return createSourceNode(node,
            node.async ? "async " : "",
            name, "(", ...joinArray(params, ","), ") {",
            ...body,
            "}"
        );
      } else if (parentScope === ScopeType.program) {
        return createSourceNode(node,
            node.async ? "async " : "",
            "function ", name, "(", ...joinArray(params, ","), ") {",
            ...body,
            "}"
        );
      } else {
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

  private transformPipelineList(nodes: ast.ASTNode[]) {
    if (nodes.length < 3) return null; 

    // 1. Detect Direction
    // We check the first operator to decide flow.
    // [A, <|, B] -> Backward
    // [A, |>, B] -> Forward
    const firstOpNode = nodes[1];
    let isBackward = false;
    
    if (firstOpNode._type === 'simple-identifier') {
        const id = (firstOpNode as ast.SimpleIdentifierNode).id;
        if (id === '<|') isBackward = true;
        else if (id !== '|>') return null; // Not a pipeline
    } else {
        return null; // Not a pipeline
    }

    // 2. Normalize to Forward Pipeline List: [Seed, |>, Step1, |>, Step2...]
    let processingNodes: ast.ASTNode[] = [];

    if (isBackward) {
        // Reverse the flow!
        // Original: [FuncA, <|, FuncB, <|, Seed]
        // Target:   [Seed, |>, FuncB, |>, FuncA]
        
        // Seed is the last element
        const seed = nodes[nodes.length - 1];
        processingNodes.push(seed);

        // Iterate backwards, skipping the operators (assuming they are all consistent)
        // i points to the Function/Step
        for (let i = nodes.length - 2; i >= 0; i -= 2) {
             const func = nodes[i-1];
             // We inject the forward operator
             processingNodes.push({ _type: 'simple-identifier', id: '|>' } as any); 
             processingNodes.push(func);
        }
    } else {
        // Already forward, just use as is
        processingNodes = nodes;
    }

    // 3. Build the Sequence
    const seed = processingNodes[0];
    const sequence: any[] = [];
    
    // Iterate in pairs: [ |>, Func ]
    for (let i = 1; i < processingNodes.length; i += 2) {
      // const opNode = processingNodes[i]; // We know it's |> now
      const funcNode = processingNodes[i+1];

      if (!funcNode) return null;

      let functionNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      let member = false;

      // Extract Function and Arguments
      if (funcNode._type === 'list') {
          // Case: (add 10)
          const listNodes = (funcNode as ast.ListNode).nodes;
          if (listNodes.length > 0) {
              functionNode = listNodes[0];
              args = listNodes.slice(1);
              
              // Member check: (.toString 16)
              if (functionNode._type === 'simple-identifier' && (functionNode as any).id.startsWith('.')) {
                  member = true;
                  const rawId = (functionNode as any).id.substring(1);
                  functionNode = { ...functionNode, id: rawId } as any;
              }
          } else {
              return null; // Empty list
          }
      } 
      else if (funcNode._type === 'simple-identifier' || funcNode._type === 'composite-identifier') {
          // Case: square
          functionNode = funcNode;
          
          // Member check: .length
          if (funcNode._type === 'simple-identifier' && (funcNode as any).id.startsWith('.')) {
              member = true;
              const rawId = (funcNode as any).id.substring(1);
              functionNode = { ...funcNode, id: rawId } as any;
          }
      } else {
          // Case: Literal/Expression (e.g. 5, "hello", etc.)
          // This allows things like: 5 |> add (where RHS is identifier)
          // OR in reversed backward pipe: square <| 5 -> 5 |> square
          // Here 'square' calls '5'? No.
          // In normalized list: [5, |>, add]. funcNode is 'add'.
          // If we had: square <| 5. Normalized: [5, |>, square]. funcNode is 'square'.
          // This handles generic nodes gracefully.
          functionNode = funcNode;
      }

      sequence.push({
          operator: 'carrying-left', // Always forward now
          function: functionNode,
          memberFunction: member,
          arguments: args
      });
    }

    // 4. Create Synthetic AST Node
    const syntheticNode: ast.FunctionCarryingNode = {
        _type: 'function-carrying',
        _location: seed._location,
        _parent: undefined,
        identifier: seed as any, 
        sequence: sequence
    };

    return this.visitFunctionCarrying(syntheticNode);
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    // 1. Flatten Right-Associative Nesting (Fix for Greedy Grammar)
    // We create a new flat sequence list by unrolling any nested pipelines found in arguments.
    const flatSequence: any[] = [];
    
    // We start with the identifier from the top node
    let current = this.visit(node.identifier);

    // Helper to recursively extract steps from a nested chain
    const collectSteps = (sequence: any[]) => {
      for (const seq of sequence) {
        // Check if the FIRST argument is actually a nested FunctionCarryingNode (The greedy parse artifact)
        if (seq.arguments.length > 0 && 
            seq.arguments[0]._type === 'function-carrying') {
              
          const nestedNode = seq.arguments[0] as ast.FunctionCarryingNode;
          
          // 1. The identifier of the nested node becomes the REAL argument for this step
          //    Original: .apply (evt1 |> ...)
          //    Fixed:    .apply evt1
          const realArg = nestedNode.identifier;
          
          // 2. Push the fixed step to our flat list
          flatSequence.push({
            ...seq,
            arguments: [realArg, ...seq.arguments.slice(1)]
          });

          // 3. Recursively collect the steps from the nested node
          collectSteps(nestedNode.sequence);
          
        } else {
          // No nesting, just add the step
          flatSequence.push(seq);
        }
      }
    };

    // Initial collection
    collectSteps(node.sequence);

    // 2. Iterate the now-linear pipeline
    for (const seq of flatSequence) {
      // Use the function identifier as the source map anchor
      const anchorNode = seq.function; 
      const fn = this.visit(anchorNode);
      const args = seq.arguments.map((a: ast.ASTNode) => this.visit(a));

      if (seq.operator === "carrying-left") {
        // Operator |> (Pipe Forward)
        if (seq.memberFunction) {
          // Logic: x |> .method a b  --> x.method(a, b)
          current = createSourceNode(anchorNode, current, '.', fn, '(', ...joinArray(args, ','), ')');
        } else {
          // Logic: x |> func a b     --> func(x, a, b)
          current = createSourceNode(anchorNode, fn, '(', ...joinArray([current, ...args], ','), ')');
        }
      } else {
        // Operator <| (Pipe Backward)
        if (seq.memberFunction) {
          // Logic: .method a b <| x  --> x.method(a, b)
          current = createSourceNode(anchorNode, current, '.', fn, '(', ...joinArray(args, ','), ')');
        } else {
          // Logic: func a b <| x     --> func(a, b, x)
          current = createSourceNode(anchorNode, fn, '(', ...joinArray([...args, current], ','), ')');
        }
      }
    }

    return current;
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

      // Always use expression form - `when` is inherently an expression construct
      // (condition) ? (expr1, expr2, ...) : undefined
      return createSourceNode(node, 
          "(", condition, ") ? (", ...joinArray(whenExprs, ","), ") : undefined"
      );
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
    
    // 1. Basic object check
    conditions.push(`(typeof ${matchVar} === 'object' && ${matchVar} !== null)`);

    pattern.pairs.forEach((pair) => {
      let keyAccess: string | SourceNode;

      // 2. Determine Key Accessor
      // In L-lang maps: { :key val } -> Key is SimpleIdentifier "key"
      // We must treat it as a string literal property name, not a variable.
      if (pair.key._type === 'simple-identifier') {
          keyAccess = `"${(pair.key as ast.SimpleIdentifierNode).id}"`;
      } else if (pair.key._type === 'string') {
          keyAccess = `"${(pair.key as ast.StringNode).value}"`;
      } else {
          // Dynamic/Computed key (rare in patterns but possible)
          keyAccess = this.visit(pair.key);
      }
      
      const memberAccess = `${matchVar}[${keyAccess}]`;
      
      // 3. Generate condition for the value at that key
      conditions.push(this.generateCondition(pair.pattern, memberAccess));
    });

    return createSourceNode(pattern, ...joinArray(conditions, " && "));
  }

  // =========================================================================
  // Identifiers / Literals
  // =========================================================================

  visitIdentifier(node: ast.IdentifierNode) {
    // If we've already mapped this identifier to a string, use it
    if (this.identifiers[node.id]) return createSourceNode(node, this.identifiers[node.id]);

    // Resolve symbol in the symbol table (if available) to check whether
    // it originates from another module. If so, inline its definition
    // into this module under a unique name.
    try {
      const resolved = this.context?.symbolTable?.resolveSymbol?.(node as any);
      // debug: log resolution
      // console.log('visitIdentifier resolve', node.id, resolved ? (resolved.value && (resolved.value as any)._location && (resolved.value as any)._location.source) : undefined);
      if (resolved && resolved.value && resolved.value._location && this.rootSource && resolved.value._location.source !== this.rootSource) {
        const uniq = this.ensureSymbolInlined(resolved);
        this.identifiers[node.id] = uniq;
        return createSourceNode(node, uniq);
      }
    } catch (e) {
      // If anything goes wrong resolving, fall back to normal encoding
    }

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

    // --- FIX: Detect Infix Pipelines ---
    // Scan for |> or <| symbols
    const hasPipelineOp = nodes.some(n => 
        n._type === 'simple-identifier' && ['|>', '<|'].includes((n as any).id)
    );

    if (hasPipelineOp) {
        // Attempt to transform. If valid pipeline, return result.
        const result = this.transformPipelineList(nodes);
        if (result) return result;
        // If malformed, fall through to normal processing
    }
    // -----------------------------------

    const [head, ...rest] = nodes;
    const isHeadIdentifier = head._type === "simple-identifier" || head._type === "composite-identifier";

    if (isHeadIdentifier) {
        const headId = (head as any).id;

        if (head._type === 'simple-identifier' && headId === 'new' && rest.length > 0) {
            const className = this.visit(rest[0]);
            const args = rest.slice(1).map(x => this.visit(x));
            return createSourceNode(node, 'new ', className, '(', ...joinArray(args, ","), ')');
        }

        if (head._type === "simple-identifier" && headId === "return") {
            if (rest.length === 0) {
                return createSourceNode(node, "return");
            }
            const returnValue = this.runInScope(ScopeType.variable, () => this.visit(rest[0]));
            return createSourceNode(node, "return ", returnValue);
        }

        const callee = this.visit(head);
        const args = rest.map(x => this.visit(x));
        const calleeStr = callee.toString();

        // 1. Class Instantiation (Implicit 'new')
        // Now that visitClass registers early, this works for recursive calls too.
        if (this.classes.includes(calleeStr)) {
            return createSourceNode(node, 'new ', callee, '(', ...joinArray(args, ","), ')');
        }

        // 2. Resolve implicit Method Calls vs Property Access
        // We need to determine if we should add "()" or not.
        
        // Extract the effective name to check against known functions.
        // For "myFunc", it's "myFunc". For "dog.speak", it's "speak".
        let memberName = calleeStr;
        if (head._type === "composite-identifier") {
           const parts = calleeStr.split('.'); 
           memberName = parts[parts.length - 1];
        }

        const isKnownFunction = this.functions.includes(calleeStr) || this.functions.includes(memberName);

        // If it has arguments, it's definitely a call.
        // If it's a known function (even with 0 args), it's a call.
        if (args.length > 0 || isKnownFunction) {
           return createSourceNode(node, callee, '(', ...joinArray(args, ","), ')'); 
        }

        // 3. Fallback: 0 args and NOT a known function -> Property/Variable Access
        // This fixes the (this.name) -> this.name() bug.
        return createSourceNode(node, callee);
    }

    // Implicit Block / Sequence
    // ... rest of the existing function
    
    const statements = nodes.map(x => this.visit(x));

    if (this.isExpressionContext()) {
        const last = statements[statements.length - 1];
        const body = statements.slice(0, -1).map(s => [s, ';']);
        
        return createSourceNode(node, 
            "(() => { ", ...body.flat(), " return ", last, "; })()"
        );
    } else {
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

  // Clone a node (structural clone) so we can safely modify names
  private cloneNode<T extends ast.ASTNode>(n: T): T {
    const cache = new Set<any>();
    return JSON.parse(JSON.stringify(n, (key, value) => {
      if (typeof value === 'object' && value !== null) {
        if (cache.has(value)) {
          // Circular reference found, discard key
          return;
        }
        // Store value in our collection
        cache.add(value);
      }
      return value;
    })) as T;
  }

  // Ensure an external symbol is inlined into the current module. Returns
  // the unique identifier name that refers to the inlined symbol.
  private ensureSymbolInlined(symbol: SymbolEntry): string {
    // console.log('ensureSymbolInlined for', (symbol.name as any).id ?? (symbol.name as any).name, 'type=', symbol.type);
    const src = (symbol.value && (symbol.value as any)._location && (symbol.value as any)._location.source) || "";
    const symName = (symbol.name as any).id ?? (symbol.name as any).name ?? String(Math.random());
    const key = `${src}::${symName}`;

    if (this.inlinedSymbols[key]) return this.inlinedSymbols[key];

    try {
      const uniq = encodeIdentifier(symName) + "_inlined_" + uniqueIdentifier();
      this.inlinedSymbols[key] = uniq;

      // Build a top-level definition for the symbol depending on its type
      let defParts: (SourceNode | string)[] = [];

      if (symbol.type === "function") {
        const fn = this.cloneNode(symbol.value as ast.FunctionNode) as ast.FunctionNode;
        // replace name
        fn.name = fn.name ? { ...fn.name, id: uniq } as any : { _type: "simple-identifier", id: uniq } as any;
        // Visiting the cloned function will inline any nested references as needed
        defParts = [ this.visit(fn) ];
      } else if (symbol.type === "class") {
        const cls = this.cloneNode(symbol.value as ast.ClassNode) as ast.ClassNode;
        cls.name = cls.name ? { ...cls.name, name: uniq } as any : { _type: "identifier", name: uniq } as any;
        defParts = [ this.visit(cls) ];
      } else if (symbol.type === "variable") {
        const v = this.cloneNode(symbol.value as ast.VariableNode) as ast.VariableNode;
        // create const uniq = <value>
        const valueNode = v.value ? this.visit(v.value) : "undefined";
        defParts = [ createSourceNode(v, "const ", uniq, " = ", valueNode, ";") ];
      } else {
        // fallback: try to visit the value node and assign to uniq
        const val = (symbol.value as any) ? this.visit(symbol.value as any) : "undefined";
        defParts = [ createSourceNode(symbol.value as any, "const ", uniq, " = ", val, ";") ];
      }

      this.inlinedDefinitions[uniq] = defParts;
      // console.log('inlinedDefinitions added', uniq);
      return uniq;
    } catch (ex) {
      console.error('ensureSymbolInlined error for', symName, ex);
      // Fallback: return a safe encoded name (no inlining)
      const fallback = encodeIdentifier(symName);
      return fallback;
    }
  }
}
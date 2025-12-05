import * as recast from "recast";
import * as ast from "../ast";
import { BaseAstVisitor } from ".";
import { Context, LogLevel } from "../Context";
import { ScopeType } from "../SymbolTable";
import { encodeIdentifier, uniqueIdentifier } from "../utils";
import path from "path";

const b = recast.types.builders;
const n = recast.types.namedTypes;

interface CompilerState {
  scope: ScopeType[];
  functions: Set<string>;
  classes: Set<string>;
  variables: Set<string>;
  identifiers: Map<string, string>;
}

export class RecastAstVisitor2 extends BaseAstVisitor {
  private state: CompilerState = {
    scope: [ScopeType.program],
    functions: new Set(),
    classes: new Set(),
    variables: new Set(),
    identifiers: new Map(),
  };

  private pushScope(scope: ScopeType): void {
    this.context.log(LogLevel.Debug, `Scope pushed ${this.currentScope()} -> ${scope}`);
    this.state.scope.unshift(scope);
  }

  private popScope(): ScopeType | undefined {
    const popped = this.state.scope.shift();
    this.context.log(LogLevel.Debug, `Scope popped ${popped} -> ${this.currentScope()}`);
    return popped;
  }

  private currentScope(): ScopeType {
    return this.state.scope[0];
  }

  private inScope(...scopes: ScopeType[]): boolean {
    return scopes.includes(this.currentScope());
  }

  compile(root: ast.ASTNode): { code: string; map: any } {
    const jsAst = this.visit(root);
    
    // Add header comments
    const headerComments = [
      b.commentLine(` Module: ${this.context.mainModule}`),
      b.commentLine(` File: ${this.context.dependencyGraph.rootUnit.location.fullName}`),
      b.commentLine(` Compiled at: ${new Date()}`),
    ];

    // Create the program with "use strict"
    const program = b.program([
      b.expressionStatement(b.literal("use strict")),
      ...jsAst.body
    ]);

    program.comments = headerComments;

    // Generate code with source map
    const result = recast.print(program, {
      sourceMapName: path.basename(root._location.source!, '.lisp') + '.js.map'
    });

    return {
      code: result.code + `\n//# sourceMappingURL=${path.basename(root._location.source!, '.lisp')}.js.map`,
      map: result.map
    };
  }

  visitProgram(node: ast.ProgramNode): any {
    const body = node.program
      .map(n => this.visit(n))
      .filter(stmt => stmt !== null && stmt !== undefined)
      .map(stmt => this.ensureStatement(stmt));
    
    return b.program(body);
  }

  visitList(node: ast.ListNode): any {
    if (node.nodes.length === 0) {
      return null;
    }

    const [first, ...rest] = node.nodes;
    
    // Handle special forms
    if (first._type === "simple-identifier" || first._type === "composite-identifier") {
      const id = (first as ast.IdentifierNode).id;
      
      // Check if it's a known function/class/variable
      if (this.state.functions.has(id)) {
        return b.callExpression(
          this.visit(first),
          rest.map(arg => this.visit(arg))
        );
      } else if (this.state.classes.has(id)) {
        return b.newExpression(
          this.visit(first),
          rest.map(arg => this.visit(arg))
        );
      } else {
        // Default to function call
        return b.callExpression(
          this.visit(first),
          rest.map(arg => this.visit(arg))
        );
      }
    }

    // For non-identifier first elements, create a sequence
    const expressions = node.nodes.map(n => this.visit(n)).filter(e => e !== null);
    
    if (this.inScope(ScopeType.variable)) {
      return b.sequenceExpression(expressions);
    }
    
    return b.blockStatement(expressions.map(e => this.ensureStatement(e)));
  }

  visitVariable(node: ast.VariableNode): any {
    this.pushScope(ScopeType.variable);
    
    const id = this.visit(node.name);
    const init = node.value ? this.visit(node.value) : null;
    
    this.popScope();

    // Track variable name
    this.state.variables.add(id.name);

    // In certain scopes, return assignment expression instead of declaration
    if (this.inScope(ScopeType.match, ScopeType.when)) {
      return b.assignmentExpression("=", id, init || b.identifier("undefined"));
    }

    return b.variableDeclaration(
      node.mutable ? "let" : "const",
      [b.variableDeclarator(id, init)]
    );
  }

  visitFunction(node: ast.FunctionNode): any {
    this.pushScope(
      this.inScope(ScopeType.class, ScopeType.interface) 
        ? ScopeType.method 
        : ScopeType.function
    );

    const id = node.name ? this.visit(node.name) : null;
    const params = node.params.map(p => this.visit(p));
    const body = b.blockStatement(
      node.body.map(stmt => this.ensureStatement(this.visit(stmt)))
    );

    this.popScope();

    // Track function name
    if (id) {
      this.state.functions.add(id.name);
    }

    // Handle different contexts
    if (this.inScope(ScopeType.class)) {
      // Class method
      return b.methodDefinition(
        "method",
        id,
        b.functionExpression(null, params, body, false, node.async)
      );
    } else if (this.inScope(ScopeType.variable, ScopeType.match, ScopeType.when, ScopeType.if)) {
      // Arrow function
      return b.arrowFunctionExpression(params, body, node.async);
    } else {
      // Function declaration or expression
      if (id) {
        return b.functionDeclaration(id, params, body, false, node.async);
      } else {
        return b.functionExpression(null, params, body, false, node.async);
      }
    }
  }

  visitParameter(node: ast.ParameterNode): any {
    return this.visit(node.name);
  }

  visitClass(node: ast.ClassNode): any {
    this.pushScope(ScopeType.class);

    const className = this.visit(node.name);
    const superClass = node.extends?.[0] ? this.visit(node.extends[0].type) : null;
    
    // Track class name
    this.state.classes.add(className.name);

    // Process class body
    const classBody = [];
    const constructorParams = [];
    const constructorBody = [];

    for (const item of node.body) {
      if (item._type === "list") {
        const listNode = item as ast.ListNode;
        for (const member of listNode.nodes) {
          if (member._type === "variable") {
            const varNode = member as ast.VariableNode;
            const hasCtorModifier = varNode.modifiers.some(m => m.modifier === "ctor");
            const isPrivate = varNode.modifiers.some(m => m.modifier === "private");
            
            if (hasCtorModifier) {
              // Constructor parameter
              const paramName = this.visit(varNode.name);
              constructorParams.push(paramName);
              constructorBody.push(
                b.expressionStatement(
                  b.assignmentExpression(
                    "=",
                    b.memberExpression(
                      b.thisExpression(),
                      isPrivate ? b.privateName(paramName) : paramName
                    ),
                    paramName
                  )
                )
              );
            } else {
              // Class field
              const fieldName = this.visit(varNode.name);
              const init = varNode.value ? this.visit(varNode.value) : null;
              classBody.push(
                b.classProperty(
                  isPrivate ? b.privateName(fieldName) : fieldName,
                  init,
                  null,
                  varNode.modifiers.some(m => m.modifier === "static")
                )
              );
            }
          } else if (member._type === "function") {
            classBody.push(this.visit(member));
          }
        }
      }
    }

    // Add constructor if needed
    if (constructorParams.length > 0) {
      classBody.unshift(
        b.methodDefinition(
          "constructor",
          b.identifier("constructor"),
          b.functionExpression(
            null,
            constructorParams,
            b.blockStatement(constructorBody)
          )
        )
      );
    }

    this.popScope();

    return b.classDeclaration(
      className,
      b.classBody(classBody),
      superClass
    );
  }

  visitIf(node: ast.IfNode): any {
    this.pushScope(ScopeType.if);

    const test = this.visit(node.condition!);
    const consequent = this.ensureStatement(this.visit(node.then!));
    const alternate = node.else ? this.ensureStatement(this.visit(node.else)) : null;

    this.popScope();

    // In expression context, use conditional expression
    if (this.inScope(ScopeType.variable, ScopeType.when, ScopeType.match)) {
      return b.conditionalExpression(
        test,
        this.visit(node.then!),
        node.else ? this.visit(node.else) : b.identifier("undefined")
      );
    }

    return b.ifStatement(test, consequent, alternate);
  }

  visitWhen(node: ast.WhenNode): any {
    this.pushScope(ScopeType.when);

    const test = this.visit(node.condition!);
    const expressions = node.then!.map(expr => this.visit(expr));

    this.popScope();

    // In expression context
    if (this.inScope(ScopeType.variable)) {
      return b.conditionalExpression(
        test,
        b.sequenceExpression(expressions),
        b.identifier("undefined")
      );
    }

    // In statement context
    return b.ifStatement(
      test,
      b.blockStatement(expressions.map(e => this.ensureStatement(e)))
    );
  }

  visitMatch(node: ast.MatchNode): any {
    this.pushScope(ScopeType.match);

    const matchVar = b.identifier(uniqueIdentifier());
    const expr = this.visit(node.expression);

    // Find all identifiers that need to be predefined
    const predefinedVars = this.findIdentifiersInPatterns(node);
    
    // Generate match cases
    const cases = node.cases.map((matchCase, index) => {
      const condition = this.generatePatternCondition(matchCase.pattern, matchVar);
      const body = this.visit(matchCase.body);
      
      return {
        test: condition,
        consequent: body
      };
    });

    // Build nested conditionals
    let result: any = b.identifier("undefined");
    for (let i = cases.length - 1; i >= 0; i--) {
      result = b.conditionalExpression(
        cases[i].test,
        cases[i].consequent,
        result
      );
    }

    // Wrap in IIFE
    const body = [];
    
    // Add predefined variables
    if (predefinedVars.length > 0) {
      body.push(
        b.variableDeclaration(
          "let",
          predefinedVars.map(v => b.variableDeclarator(b.identifier(v)))
        )
      );
    }

    body.push(b.returnStatement(result));

    this.popScope();

    return b.callExpression(
      b.functionExpression(
        null,
        [matchVar],
        b.blockStatement(body)
      ),
      [expr]
    );
  }

  visitString(node: ast.StringNode): any {
    return b.literal(node.value);
  }

  visitFormattedString(node: ast.FormattedStringNode): any {
    const elements = [];
    const expressions = [];

    node.value.forEach((item, index) => {
      if (item._type === "string") {
        elements.push(b.templateElement(
          { raw: item.value, cooked: item.value },
          index === node.value.length - 1
        ));
      } else if (item._type === "format-expression") {
        const expr = this.visit((item as ast.FormatExpressionNode).expression);
        expressions.push(
          b.callExpression(
            b.identifier("formatObjectToString"),
            [expr]
          )
        );
        if (index < node.value.length - 1) {
          elements.push(b.templateElement({ raw: "", cooked: "" }, false));
        }
      }
    });

    return b.templateLiteral(elements, expressions);
  }

  visitBoolean(node: ast.BooleanNode): any {
    return b.literal(node.value);
  }

  visitNull(node: ast.NullNode): any {
    return b.literal(null);
  }

  visitNumber(node: ast.NumberNode): any {
    if (node._type === "fraction-number") {
      const frac = node as ast.FractionNumberNode;
      return b.binaryExpression(
        "/",
        b.literal(frac.numerator),
        b.literal(frac.denominator)
      );
    }
    return b.literal((node as any).value);
  }

  visitIdentifier(node: ast.IdentifierNode): any {
    const encoded = encodeIdentifier(node.id);
    this.state.identifiers.set(node.id, encoded);
    return b.identifier(encoded);
  }

  visitVector(node: ast.VectorNode): any {
    return b.arrayExpression(
      node.values.map(v => this.visit(v))
    );
  }

  visitMap(node: ast.MapNode): any {
    const properties = node.values.map(kv => {
      if (kv._type === "key-value") {
        const kvNode = kv as ast.KeyValueNode;
        const key = kvNode.key._type === "string" 
          ? b.literal((kvNode.key as ast.StringNode).value)
          : this.visit(kvNode.key);
        return b.property("init", key, this.visit(kvNode.value));
      }
      return null;
    }).filter(p => p !== null);

    return b.objectExpression(properties);
  }

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): any {
    return b.assignmentExpression(
      "=",
      this.visit(node.assignable),
      this.visit(node.value)
    );
  }

  visitAwait(node: ast.AwaitNode): any {
    return b.awaitExpression(this.visit(node.expression));
  }

  visitSpread(node: ast.SpreadNode): any {
    return b.spreadElement(this.visit(node.expression));
  }

  visitWhile(node: ast.WhileNode): any {
    return b.whileStatement(
      this.visit(node.condition),
      this.ensureStatement(this.visit(node.then))
    );
  }

  visitTryCatch(node: ast.TryCatchNode): any {
    const tryBlock = b.blockStatement(
      [this.visit(node.try)].flat().map(s => this.ensureStatement(s))
    );

    const catchParam = b.identifier(uniqueIdentifier());
    const handlers = [];

    // Process catch blocks
    if (node.catch && node.catch.length > 0) {
      const catchBody = [];

      // Type-specific catches
      const typedCatches = node.catch.filter(c => c.filter);
      typedCatches.forEach((catchBlock, index) => {
        const condition = b.binaryExpression(
          "instanceof",
          catchParam,
          this.visit(catchBlock.filter!.type)
        );
        
        const body = b.blockStatement([
          b.variableDeclaration("const", [
            b.variableDeclarator(
              this.visit(catchBlock.filter!.name),
              catchParam
            )
          ]),
          this.ensureStatement(this.visit(catchBlock.body))
        ]);

        if (index === 0) {
          catchBody.push(b.ifStatement(condition, body));
        } else {
          // Append to previous if statement
          let current = catchBody[catchBody.length - 1];
          while (current.alternate && current.alternate.type === "IfStatement") {
            current = current.alternate;
          }
          current.alternate = b.ifStatement(condition, body);
        }
      });

      // Default catch
      const defaultCatch = node.catch.find(c => !c.filter);
      if (defaultCatch) {
        const defaultBody = this.ensureStatement(this.visit(defaultCatch.body));
        if (catchBody.length > 0) {
          let current = catchBody[catchBody.length - 1];
          while (current.alternate && current.alternate.type === "IfStatement") {
            current = current.alternate;
          }
          current.alternate = defaultBody;
        } else {
          catchBody.push(defaultBody);
        }
      } else if (catchBody.length > 0) {
        // If no default, rethrow
        let current = catchBody[catchBody.length - 1];
        while (current.alternate && current.alternate.type === "IfStatement") {
          current = current.alternate;
        }
        current.alternate = b.throwStatement(catchParam);
      }

      handlers.push(b.catchClause(
        catchParam,
        null,
        b.blockStatement(catchBody)
      ));
    }

    const finallyBlock = node.finally 
      ? b.blockStatement([this.ensureStatement(this.visit(node.finally))])
      : null;

    return b.tryStatement(tryBlock, handlers[0] || null, finallyBlock);
  }

  visitComment(node: ast.CommentNode): any {
    return b.noop();
  }

  visitKeyValue(node: ast.KeyValueNode): any {
    // Handled in visitMap
    return null;
  }

  // Helper methods

  private ensureStatement(node: any): any {
    if (!node) return b.emptyStatement();
    
    if (n.Expression.check(node)) {
      return b.expressionStatement(node);
    }
    return node;
  }

  private findIdentifiersInPatterns(node: ast.MatchNode): string[] {
    const identifiers: Set<string> = new Set();

    const walkPattern = (pattern: ast.PatternNode): void => {
      switch (pattern._type) {
        case "identifier-pattern":
          identifiers.add((pattern as ast.IdentifierPatternNode).id.id);
          break;
        case "list-pattern":
        case "vector-pattern":
          (pattern as ast.ListPatternNode).elements.forEach(walkPattern);
          break;
        case "map-pattern":
          (pattern as ast.MapPatternNode).pairs.forEach(pair => 
            walkPattern(pair.pattern)
          );
          break;
      }
    };

    node.cases.forEach(c => walkPattern(c.pattern));
    return Array.from(identifiers);
  }

  private generatePatternCondition(pattern: ast.PatternNode, value: any): any {
    switch (pattern._type) {
      case "any-pattern":
        return b.literal(true);
        
      case "identifier-pattern":
        const id = this.visit((pattern as ast.IdentifierPatternNode).id);
        return b.sequenceExpression([
          b.assignmentExpression("=", id, value),
          b.literal(true)
        ]);
        
      case "constant-pattern":
        const constPattern = pattern as ast.ConstantPatternNode;
        return b.binaryExpression(
          "===",
          value,
          this.visit(constPattern.constant)
        );
        
      case "list-pattern":
      case "vector-pattern":
        const listPattern = pattern as ast.ListPatternNode;
        const conditions = [
          b.callExpression(
            b.memberExpression(b.identifier("Array"), b.identifier("isArray")),
            [value]
          ),
          b.binaryExpression(
            "===",
            b.memberExpression(value, b.identifier("length")),
            b.literal(listPattern.elements.length)
          )
        ];
        
        listPattern.elements.forEach((elem, idx) => {
          const elemValue = b.memberExpression(
            value,
            b.literal(idx),
            true
          );
          conditions.push(this.generatePatternCondition(elem, elemValue));
        });
        
        return conditions.reduce((acc, cond) => 
          b.logicalExpression("&&", acc, cond)
        );
        
      case "map-pattern":
        const mapPattern = pattern as ast.MapPatternNode;
        const mapConditions = [
          b.binaryExpression(
            "===",
            b.unaryExpression("typeof", value),
            b.literal("object")
          ),
          b.binaryExpression("!==", value, b.literal(null))
        ];
        
        mapPattern.pairs.forEach(pair => {
          const key = pair.key._type === "string"
            ? b.literal((pair.key as ast.StringNode).value)
            : this.visit(pair.key);
          
          mapConditions.push(
            b.binaryExpression(
              "in",
              key,
              value
            )
          );
          
          const elemValue = b.memberExpression(value, key, true);
          mapConditions.push(
            this.generatePatternCondition(pair.pattern, elemValue)
          );
        });
        
        return mapConditions.reduce((acc, cond) => 
          b.logicalExpression("&&", acc, cond)
        );
        
      default:
        return b.literal(false);
    }
  }

  // Visit methods for remaining node types...
  visitQuote(node: ast.QuoteNode): any {
    // For now, serialize the AST as JSON
    return b.callExpression(
      b.memberExpression(b.identifier("JSON"), b.identifier("parse")),
      [b.literal(JSON.stringify(node, (key, val) => 
        ["_location", "_parent"].includes(key) ? undefined : val
      ))]
    );
  }

  visitImport(node: ast.ImportNode): any {
    // This would need to be handled at a higher level for ES6 modules
    return b.noop();
  }

  visitExport(node: ast.ExportNode): any {
    // This would need to be handled at a higher level for ES6 modules  
    return b.noop();
  }

  // Stub implementations for remaining visit methods
  visitIndexer(node: ast.IndexerNode): any {
    const object = this.visit(node.id);
    
    // Handle multiple index dimensions
    return node.indices.reduce((acc, indexGroup) => {
      if (indexGroup.length === 1) {
        return b.memberExpression(acc, this.visit(indexGroup[0]), true);
      }
      // For multiple indices, could implement as function call
      return b.callExpression(
        b.memberExpression(acc, b.identifier("get")),
        indexGroup.map(idx => this.visit(idx))
      );
    }, object);
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode): any {
    let result = this.visit(node.identifier);
    
    node.sequence.forEach(seq => {
      const fn = this.visit(seq.function);
      const args = seq.arguments.map(arg => this.visit(arg));
      
      if (seq.memberFunction) {
        result = b.callExpression(
          b.memberExpression(result, fn),
          args
        );
      } else {
        if (seq.operator === "carrying-left") {
          result = b.callExpression(fn, [result, ...args]);
        } else {
          result = b.callExpression(fn, [...args, result]);
        }
      }
    });
    
    return result;
  }

  visitControlComment(node: ast.ControlCommentNode): any {
    // These could be converted to directives or comments
    return b.noop();
  }

  // Type-related nodes (would be stripped in JS output)
  visitType(node: ast.TypeNode): any { return b.identifier("any"); }
  visitTypeName(node: ast.TypeNameNode): any { return b.identifier(node.name); }
  visitUnionType(node: ast.UnionTypeNode): any { return b.identifier("any"); }
  visitIntersectionType(node: ast.IntersectionTypeNode): any { return b.identifier("any"); }
  visitFunctionType(node: ast.FunctionTypeNode): any { return b.identifier("Function"); }
  visitSimpleType(node: ast.SimpleTypeNode): any { return b.identifier(node.name.name); }
  visitGenericType(node: ast.GenericTypeNode): any { return b.identifier(node.name.name); }
  visitMapType(node: ast.MapTypeNode): any { return b.identifier("Object"); }
  visitMapKeyType(node: ast.MapKeyTypeNode): any { return b.identifier("any"); }
  visitMappedType(node: ast.MappedTypeNode): any { return b.identifier("any"); }

  // Other node types
  visitModifier(node: ast.ModifierNode): any { return null; }
  visitEnum(node: ast.EnumNode): any { return b.noop(); }
  visitStruct(node: ast.StructNode): any { return b.noop(); }
  visitTypeDef(node: ast.TypeDefNode): any { return b.noop(); }
  visitInterface(node: ast.InterfaceNode): any { return b.noop(); }
  visitImplements(node: ast.ImplementsNode): any { return null; }
  visitExtends(node: ast.ExtendsNode): any { return null; }
  visitTypeConstraint(node: ast.TypeConstraintNode): any { return null; }
  visitCompoundAssignment(node: ast.CompoundAssignmentNode): any {
    return b.assignmentExpression(
      node.operator + "=",
      this.visit(node.assignable),
      this.visit(node.value)
    );
  }
  visitCond(node: ast.CondNode): any {
    // Convert to if-elseif chain
    let result: any = null;
    
    for (let i = node.cases.length - 1; i >= 0; i--) {
      const cond = this.visit(node.cases[i].condition);
      const body = this.ensureStatement(this.visit(node.cases[i].body));
      
      if (result === null) {
        result = b.ifStatement(cond, body);
      } else {
        result = b.ifStatement(cond, body, result);
      }
    }
    
    return result || b.emptyStatement();
  }
  visitCondCase(node: ast.CondCaseNode): any { 
    // Handled in visitCond
    return null; 
  }
  visitFor(node: ast.ForNode): any {
    const init = node.initial ? this.visit(node.initial) : null;
    const test = node.condition ? this.visit(node.condition) : null;
    const update = node.step ? this.visit(node.step) : null;
    const body = this.ensureStatement(this.visit(node.then));
    
    return b.forStatement(init, test, update, body);
  }
  visitForEach(node: ast.ForEachNode): any {
    const left = b.variableDeclaration("const", [
      b.variableDeclarator(this.visit(node.variable))
    ]);
    const right = this.visit(node.collection);
    const body = this.ensureStatement(this.visit(node.then));
    
    return b.forOfStatement(left, right, body);
  }
  visitMatchCase(node: ast.MatchCaseNode): any { 
    // Handled in visitMatch
    return null; 
  }

  // Pattern nodes (handled in match)
  visitAnyPattern(node: ast.AnyPatternNode): any { return null; }
  visitFunctionalPattern(node: ast.FunctionalPatternNode): any { return null; }
  visitTypePattern(node: ast.TypePatternNode): any { return null; }
  visitListPattern(node: ast.ListPatternNode): any { return null; }
  visitVectorPattern(node: ast.VectorPatternNode): any { return null; }
  visitMapPattern(node: ast.MapPatternNode): any { return null; }
  visitMapPatternPair(node: ast.MapPatternPairNode): any { return null; }
  visitIdentifierPattern(node: ast.IdentifierPatternNode): any { return null; }
  visitConstantPattern(node: ast.ConstantPatternNode): any { return null; }

  // Number nodes
  visitOctalNumber(node: ast.OctalNumberNode): any { return b.literal(node.value); }
  visitBinaryNumber(node: ast.BinaryNumberNode): any { return b.literal(node.value); }
  visitHexNumber(node: ast.HexNumberNode): any { return b.literal(node.value); }
  visitFractionNumber(node: ast.FractionNumberNode): any {
    return b.binaryExpression(
      "/",
      b.literal(node.numerator),
      b.literal(node.denominator)
    );
  }
  visitIntegerNumber(node: ast.IntegerNumberNode): any { return b.literal(node.value); }
  visitFloatNumber(node: ast.FloatNumberNode): any { return b.literal(node.value); }
  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): any { return this.visitIdentifier(node); }
  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): any { return this.visitIdentifier(node); }
  visitFormatExpression(node: ast.FormatExpressionNode): any {
    return b.callExpression(
      b.identifier("formatObjectToString"),
      [this.visit(node.expression)]
    );
  }
  visitMatrix(node: ast.MatrixNode): any {
    // Matrix as array of arrays
    return b.arrayExpression(
      node.rows.map(row => 
        b.arrayExpression(row.map(cell => this.visit(cell)))
      )
    );
  }
}
import * as estree from "estree";
import * as ast from "../ast";
import { BaseAstVisitor } from "./BaseAstVisitor";
import { Context, LogLevel } from "../Context";
import { encodeIdentifier, uniqueIdentifier } from "../utils";

/**
 * JSTransformerAstVisitor
 * 
 * Transforms l-lang AST nodes into ESTree (ECMAScript) AST nodes.
 * This visitor returns structured AST nodes instead of concatenated strings,
 * allowing for better code generation and source map handling via astring.
 * 
 * Benefits over string concatenation:
 * - No fragile string joining logic
 * - Proper source maps via astring
 * - Easier to debug and reason about transformations
 * - Can be validated and processed by other tools
 */
export class JSTransformerAstVisitor extends BaseAstVisitor {
  private scopes: string[][] = [[]]; // Track variable scopes for hoisting
  private currentScopeIndex: number = 0;

  constructor(context: Context) {
    super(context);
  }

  /**
   * Main compilation entry point
   */
  compile(root: ast.ASTNode): estree.Program {
    if (root._type !== "program") {
      throw new Error(`Expected program node, got ${root._type}`);
    }
    return this.visitProgram(root as ast.ProgramNode);
  }

  // ============================================================================
  // PROGRAM & STRUCTURE
  // ============================================================================

  visitProgram(node: ast.ProgramNode): estree.Program {
    const body = node.program.map(stmt => this.visit(stmt)).filter((node): node is estree.Statement => {
      return node !== null && (node as any).type !== undefined;
    });
    return {
      type: "Program",
      body,
      sourceType: "module"
    };
  }

  // ============================================================================
  // LITERALS & PRIMITIVES
  // ============================================================================

  visitString(node: ast.StringNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: `"${node.value.replace(/"/g, '\\"')}"`
    };
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: String(node.value)
    };
  }

  visitFloatNumber(node: ast.FloatNumberNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: String(node.value)
    };
  }

  visitHexNumber(node: ast.HexNumberNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: node.match
    };
  }

  visitOctalNumber(node: ast.OctalNumberNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: node.match
    };
  }

  visitBinaryNumber(node: ast.BinaryNumberNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: node.match
    };
  }

  visitComplexNumber(node: ast.ComplexNumberNode): estree.CallExpression {
    // Complex numbers: represent as Complex(real, imaginary)
    return {
      type: "CallExpression",
      callee: {
        type: "Identifier",
        name: "Complex"
      },
      arguments: [
        {
          type: "Literal",
          value: node.real,
          raw: String(node.real)
        },
        {
          type: "Literal",
          value: node.imaginary,
          raw: String(node.imaginary)
        }
      ],
      optional: false
    };
  }

  visitFractionNumber(node: ast.FractionNumberNode): estree.CallExpression {
    // Fractions: represent as Fraction(numerator, denominator)
    return {
      type: "CallExpression",
      callee: {
        type: "Identifier",
        name: "Fraction"
      },
      arguments: [
        {
          type: "Literal",
          value: node.numerator,
          raw: String(node.numerator)
        },
        {
          type: "Literal",
          value: node.denominator,
          raw: String(node.denominator)
        }
      ],
      optional: false
    };
  }

  visitBoolean(node: ast.BooleanNode): estree.Literal {
    return {
      type: "Literal",
      value: node.value,
      raw: node.value ? "true" : "false"
    };
  }

  visitNull(node: ast.NullNode): estree.Literal {
    return {
      type: "Literal",
      value: null,
      raw: "null"
    };
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): estree.Identifier {
    return {
      type: "Identifier",
      name: encodeIdentifier(node.id)
    };
  }

  visitCompositeIdentifier(node: ast.CompositeIdentifierNode): estree.MemberExpression {
    // Composite identifiers like a.b.c become MemberExpressions
    let object: estree.Expression = {
      type: "Identifier",
      name: encodeIdentifier(node.parts[0])
    };

    for (let i = 1; i < node.parts.length; i++) {
      object = {
        type: "MemberExpression",
        object,
        property: {
          type: "Identifier",
          name: node.parts[i]
        },
        computed: false,
        optional: false
      };
    }

    return object as estree.MemberExpression;
  }

  // ============================================================================
  // COLLECTIONS
  // ============================================================================

  visitList(node: ast.ListNode): estree.ArrayExpression {
    const elements = node.nodes.map(elem => {
      const visited = this.visit(elem);
      return visited as estree.Expression | null;
    });
    return {
      type: "ArrayExpression",
      elements
    };
  }

  visitVector(node: ast.VectorNode): estree.ArrayExpression {
    const elements = node.values.map(elem => this.visit(elem) as estree.Expression | null);
    return {
      type: "ArrayExpression",
      elements
    };
  }

  visitMap(node: ast.MapNode): estree.ObjectExpression {
    // MapNode.values contains KeyValueNode items
    const properties: estree.Property[] = node.values.map((item: ast.ASTNode) => {
      if (item._type === "key-value") {
        const kvNode = item as ast.KeyValueNode;
        const keyNode = this.visit(kvNode.key) as estree.Expression;
        const valueNode = this.visit(kvNode.value) as estree.Expression;
        
        const computed = keyNode.type !== "Identifier" && keyNode.type !== "Literal";
        
        return {
          type: "Property" as const,
          kind: "init" as const,
          key: keyNode,
          value: valueNode,
          computed,
          shorthand: false
        } as estree.Property;
      }
      return undefined as any;
    }).filter((p): p is estree.Property => p !== undefined);
    
    return {
      type: "ObjectExpression",
      properties
    };
  }

  // ============================================================================
  // VARIABLES & DECLARATIONS
  // ============================================================================

  visitVariable(node: ast.VariableNode): estree.VariableDeclaration {
    const id = this.visit(node.name) as estree.Identifier;
    const init = node.value ? this.visit(node.value) as estree.Expression : null;
    const kind = node.mutable ? "let" : "const";
    
    return {
      type: "VariableDeclaration",
      declarations: [{
        type: "VariableDeclarator",
        id,
        init
      }],
      kind
    };
  }

  // ============================================================================
  // CONTROL FLOW
  // ============================================================================

  visitIf(node: ast.IfNode): estree.IfStatement {
    const test = this.visit(node.condition) as estree.Expression;
    const thenNode = this.visit(node.then);
    const consequent: estree.Statement = thenNode && thenNode.type ? 
      (thenNode as estree.Statement) : 
      { type: "BlockStatement", body: [] };
    const elseNode = node.else ? this.visit(node.else) : null;
    const alternate: estree.Statement | null = elseNode && elseNode.type ? 
      (elseNode as estree.Statement) : 
      null;
    
    return {
      type: "IfStatement",
      test,
      consequent,
      alternate
    };
  }

  visitWhile(node: ast.WhileNode): estree.WhileStatement {
    const test = this.visit(node.condition) as estree.Expression;
    const body = this.visit(node.then) as estree.Statement;
    
    return {
      type: "WhileStatement",
      test,
      body
    };
  }

  visitFor(node: ast.ForNode): estree.ForStatement {
    const init = node.init ? this.visit(node.init) as estree.VariableDeclaration | estree.Expression : null;
    const test = node.condition ? this.visit(node.condition) as estree.Expression : null;
    const update = node.update ? this.visit(node.update) as estree.Expression : null;
    const body = this.visit(node.body) as estree.Statement;
    
    return {
      type: "ForStatement",
      init,
      test,
      update,
      body
    };
  }

  visitForEach(node: ast.ForEachNode): estree.ForOfStatement {
    const left = this.visit(node.variable) as estree.VariableDeclaration;
    const right = this.visit(node.sequence) as estree.Expression;
    const body = this.visit(node.body) as estree.Statement;
    
    return {
      type: "ForOfStatement",
      left,
      right,
      body,
      await: false
    };
  }

  /**
   * Converts match expressions to a switch statement or IIFE
   * Pattern matching is complex, so we generate a clean switch structure
   */
  visitMatch(node: ast.MatchNode): estree.Statement | estree.Expression {
    const discriminant = this.visit(node.expr) as estree.Expression;
    
    const cases = node.cases.map(matchCase => {
      const pattern = matchCase.pattern;
      
      // For now, handle simple constant patterns
      let test: estree.Expression | null = null;
      if (pattern._type === "constant-pattern") {
        test = this.visit((pattern as ast.ConstantPatternNode).constant) as estree.Expression;
      } else {
        // For complex patterns, we'll generate a test function
        // This is a simplified approach - full pattern matching is more complex
        this.context.log(LogLevel.Warning, `Complex pattern matching not yet fully implemented for ${pattern._type}`);
        test = { type: "Literal", value: true, raw: "true" } as estree.Literal;
      }
      
      const consequent = [
        this.visit(matchCase.body) as estree.Statement
      ];
      
      return {
        type: "SwitchCase" as const,
        test,
        consequent
      };
    });
    
    return {
      type: "SwitchStatement",
      discriminant,
      cases
    };
  }

  visitWhen(node: ast.WhenNode): estree.IfStatement {
    const test = this.visit(node.condition!) as estree.Expression;
    const bodyStmts = node.then.map(stmt => this.visit(stmt) as estree.Statement).filter((s): s is estree.Statement => s !== null);
    const consequent: estree.Statement = bodyStmts.length === 1 ? 
      bodyStmts[0] : 
      { type: "BlockStatement", body: bodyStmts };
    
    return {
      type: "IfStatement",
      test,
      consequent,
      alternate: null
    };
  }

  visitCond(node: ast.CondNode): estree.IfStatement | estree.ExpressionStatement {
    // Reduce cond to if-else chain
    let result: estree.IfStatement | null = null;
    let current = result;
    
    for (let i = node.cases.length - 1; i >= 0; i--) {
      const caseNode = node.cases[i];
      const test = this.visit(caseNode.condition) as estree.Expression;
      const consequent = this.visit(caseNode.body) as estree.Statement;
      
      const ifStmt: estree.IfStatement = {
        type: "IfStatement",
        test,
        consequent,
        alternate: current
      };
      result = ifStmt;
    }
    
    return result || {
      type: "ExpressionStatement",
      expression: { type: "Literal", value: null, raw: "null" } as estree.Literal
    };
  }

  // ============================================================================
  // FUNCTIONS
  // ============================================================================

  visitFunction(node: ast.FunctionNode): estree.FunctionDeclaration | estree.FunctionExpression {
    const id = node.name ? this.visit(node.name) as estree.Identifier : null;
    const params = node.params.map(param => this.visit(param) as estree.Pattern);
    
    const bodyStatements = node.body.map(stmt => this.visit(stmt) as estree.Statement);
    const body: estree.BlockStatement = {
      type: "BlockStatement",
      body: bodyStatements
    };
    
    if (id) {
      return {
        type: "FunctionDeclaration",
        id,
        params,
        body,
        async: node.async || false,
        generator: false
      };
    } else {
      return {
        type: "FunctionExpression",
        id: null,
        params,
        body,
        async: node.async || false,
        generator: false
      };
    }
  }

  visitParameter(node: ast.ParameterNode): estree.Identifier {
    return {
      type: "Identifier",
      name: encodeIdentifier(node.name.id)
    };
  }

  // ============================================================================
  // ASSIGNMENTS & OPERATIONS
  // ============================================================================

  visitSimpleAssignment(node: ast.SimpleAssignmentNode): estree.AssignmentExpression {
    const left = this.visit(node.assignable) as estree.Pattern;
    const right = this.visit(node.value) as estree.Expression;
    
    return {
      type: "AssignmentExpression",
      operator: "=",
      left: left as estree.AssignmentExpression["left"],
      right
    };
  }

  visitCompoundAssignment(node: ast.CompoundAssignmentNode): estree.AssignmentExpression {
    const left = this.visit(node.assignable) as estree.Pattern;
    const right = this.visit(node.value) as estree.Expression;
    
    // Map l-lang operators to JS operators
    const operatorMap: Record<string, string> = {
      "+=": "+=",
      "-=": "-=",
      "*=": "*=",
      "/=": "/=",
      "%=": "%=",
      "|=": "|=",
      "&=": "&=",
      "^=": "^=",
      "<<=": "<<=",
      ">>=": ">>=",
      ">>>=": ">>>="
    };
    
    const operator = operatorMap[node.operator] || "+=";
    
    return {
      type: "AssignmentExpression",
      operator: operator as estree.AssignmentExpression["operator"],
      left: left as estree.AssignmentExpression["left"],
      right
    };
  }

  visitIndexer(node: ast.IndexerNode): estree.MemberExpression {
    const object = this.visit(node.object) as estree.Expression;
    const index = this.visit(node.index) as estree.Expression;
    
    return {
      type: "MemberExpression",
      object,
      property: index,
      computed: true,
      optional: false
    };
  }

  // ============================================================================
  // CLASSES & INTERFACES
  // ============================================================================

  visitClass(node: ast.ClassNode): estree.ClassDeclaration {
    const id = this.visit(node.name) as estree.Identifier;
    const superClass = node.extends && node.extends.length > 0 ? this.visit(node.extends[0].type) as estree.Expression : null;
    
    const body: estree.ClassBody = {
      type: "ClassBody",
      body: node.body.map(member => {
        if (member._type === "function") {
          const fn = member as ast.FunctionNode;
          const key = this.visit(fn.name!) as estree.Identifier;
          const params = fn.params.map(p => this.visit(p) as estree.Pattern);
          const fnBody: estree.BlockStatement = {
            type: "BlockStatement",
            body: fn.body.map(stmt => this.visit(stmt) as estree.Statement)
          };
          
          return {
            type: "MethodDefinition",
            key,
            value: {
              type: "FunctionExpression",
              id: null,
              params,
              body: fnBody,
              async: fn.async || false,
              generator: false
            },
            kind: fn.name?.id === "constructor" ? "constructor" : "method",
            computed: false,
            static: false
          } as estree.MethodDefinition;
        } else if (member._type === "variable") {
          const varNode = member as ast.VariableNode;
          const key = this.visit(varNode.name) as estree.Identifier;
          
          return {
            type: "PropertyDefinition",
            key,
            value: varNode.value ? this.visit(varNode.value) as estree.Expression : null,
            computed: false,
            static: false
          } as any; // PropertyDefinition not in estree yet
        }
        return null;
      }).filter((m): m is estree.MethodDefinition => m !== null && m.type === "MethodDefinition")
    };
    
    return {
      type: "ClassDeclaration",
      id,
      superClass,
      body
    };
  }

  // ============================================================================
  // ERROR HANDLING
  // ============================================================================

  visitTryCatch(node: ast.TryCatchNode): estree.TryStatement {
    const tryStmt = this.visit(node.try);
    const tryBlock: estree.BlockStatement = tryStmt && tryStmt.type === "BlockStatement" ?
      (tryStmt as estree.BlockStatement) :
      { type: "BlockStatement", body: tryStmt ? [tryStmt as estree.Statement] : [] };
    
    let handler: estree.CatchClause | null = null;
    if (node.catch && node.catch.length > 0) {
      const filter = node.catch[0];
      const param = this.visit(filter.filter.name) as estree.Identifier;
      const bodyStmt = this.visit(filter.body);
      const catchBlock: estree.BlockStatement = bodyStmt && bodyStmt.type === "BlockStatement" ?
        (bodyStmt as estree.BlockStatement) :
        { type: "BlockStatement", body: bodyStmt ? [bodyStmt as estree.Statement] : [] };
      
      handler = {
        type: "CatchClause",
        param,
        body: catchBlock
      };
    }
    
    const finallyStmt = node.finally ? this.visit(node.finally) : null;
    const finalizer: estree.BlockStatement | null = finallyStmt && finallyStmt.type === "BlockStatement" ?
      (finallyStmt as estree.BlockStatement) :
      (finallyStmt ? { type: "BlockStatement", body: [finallyStmt as estree.Statement] } : null);
    
    return {
      type: "TryStatement",
      block: tryBlock,
      handler,
      finalizer
    };
  }

  // ============================================================================
  // MISCELLANEOUS
  // ============================================================================

  visitAwait(node: ast.AwaitNode): estree.AwaitExpression {
    const argument = this.visit(node.expression) as estree.Expression;
    return {
      type: "AwaitExpression",
      argument
    };
  }

  visitSpread(node: ast.SpreadNode): estree.SpreadElement {
    const argument = this.visit(node.expression) as estree.Expression;
    return {
      type: "SpreadElement",
      argument
    };
  }

  visitQuote(node: ast.QuoteNode): estree.Literal {
    // Quotes are typically compile-time only, represent as string for now
    return {
      type: "Literal",
      value: node.mode,
      raw: `"${node.mode}"`
    };
  }

  visitKeyValue(node: ast.KeyValueNode): estree.Property {
    const keyNode = this.visit(node.key) as estree.Expression;
    const valueNode = this.visit(node.value) as estree.Expression;
    
    const computed = keyNode.type !== "Identifier" && keyNode.type !== "Literal";
    
    return {
      type: "Property",
      kind: "init",
      key: keyNode,
      value: valueNode,
      computed,
      shorthand: false,
      method: false
    };
  }

  visitComment(node: ast.CommentNode): null {
    // Comments are typically stripped in AST, return null
    return null;
  }

  visitControlComment(node: ast.ControlCommentNode): null {
    // Control comments are compiler directives, not code
    return null;
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode): estree.CallExpression | estree.MemberExpression {
    let result: estree.Expression = this.visit(node.identifier) as estree.Identifier;
    
    for (const apply of node.sequence) {
      const fn = this.visit(apply.function) as estree.Identifier;
      const args = apply.arguments.map(arg => this.visit(arg) as estree.Expression);
      
      if (apply.memberFunction) {
        // Member function call: result.fn(args)
        result = {
          type: "CallExpression",
          callee: {
            type: "MemberExpression",
            object: result,
            property: fn,
            computed: false,
            optional: false
          },
          arguments: args,
          optional: false
        };
      } else {
        // Regular function call
        if (apply.operator === "carrying-left") {
          // fn(result, ...args)
          result = {
            type: "CallExpression",
            callee: fn,
            arguments: [result, ...args],
            optional: false
          };
        } else {
          // fn(...args, result)
          result = {
            type: "CallExpression",
            callee: fn,
            arguments: [...args, result],
            optional: false
          };
        }
      }
    }
    
    return result as any;
  }

  visitFormattedString(node: ast.FormattedStringNode): estree.TemplateLiteral {
    // Convert formatted string to template literal
    const quasis: estree.TemplateElement[] = [];
    const expressions: estree.Expression[] = [];
    
    // Process parts - alternate between string and expression
    let i = 0;
    for (const part of node.parts) {
      if (typeof part === "string") {
        quasis.push({
          type: "TemplateElement",
          value: { raw: part, cooked: part },
          tail: i === node.parts.length - 1
        });
      } else {
        // It's a format expression node
        const exprNode = this.visit(part as ast.ASTNode) as estree.Expression;
        expressions.push(exprNode);
      }
      i++;
    }
    
    return {
      type: "TemplateLiteral",
      quasis,
      expressions
    };
  }

  visitFormatExpression(node: ast.FormatExpressionNode): estree.Expression {
    return this.visit(node.expression) as estree.Expression;
  }

  // ============================================================================
  // DEFAULT VISITOR (Fallback)
  // ============================================================================

  visit(node: ast.ASTNode | null | undefined): estree.Node | null {
    if (!node) {
      return null;
    }

    const methodName = `visit${node._type.split("-").map(word => word.charAt(0).toUpperCase() + word.slice(1)).join("")}`;
    const method = (this as any)[methodName];
    
    if (typeof method === "function") {
      return method.call(this, node);
    }

    this.context.log(LogLevel.Warning, `No visitor method for node type: ${node._type}`);
    return null;
  }
}

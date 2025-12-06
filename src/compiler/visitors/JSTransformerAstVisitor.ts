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
  private inProgramContext: boolean = false; // Track if we're processing program-level statements

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
    this.inProgramContext = true;
    
    let programItems = node.program;
    
    // Special case: if the entire program is wrapped in a single list (common in Lisp),
    // unwrap it ONLY if it contains actual statements (all items are statement-like, ignoring comments)
    if (programItems.length === 1 && programItems[0]._type === "list") {
      const listNode = programItems[0] as ast.ListNode;
      
      // Filter out comments to get actual content nodes
      const nonCommentNodes = listNode.nodes.filter(n => n._type !== "comment");
      
      // Check if ALL non-comment items are statement-like
      // If so, unwrap and process as individual statements
      // If not, keep as a list and process as a potential function call
      const allStatementLike = nonCommentNodes.length === 0 || 
        nonCommentNodes.every(node => this.isStatementLike(node));
      
      if (allStatementLike) {
        programItems = listNode.nodes;
      }
      // Otherwise keep programItems as the single list, which will be processed as an expression
    }
    
    const body: estree.Statement[] = [];
    
    for (let idx = 0; idx < programItems.length; idx++) {
      const stmt = programItems[idx];
      
      // Skip comments - they don't generate code
      if (stmt._type === "comment") {
        continue;
      }
      
      const visited = this.visit(stmt);
      
      // Handle flattened statement arrays
      if (Array.isArray(visited)) {
        for (const v of visited) {
          if (v && (v as any).type && (v as any).type !== "ArrayExpression") {
            body.push(v as estree.Statement);
          }
        }
        continue;
      }
      
      // Skip ArrayExpressions - they shouldn't be in program body
      if (visited && (visited as any).type === "ArrayExpression") {
        continue;
      }
      
      // Convert expressions to expression statements
      if (visited && (visited as any).type) {
        const type = (visited as any).type;
        if (type.endsWith("Declaration") || type.endsWith("Statement")) {
          body.push(visited as estree.Statement);
        } else if (type === "CallExpression" || type === "AssignmentExpression" || type === "FunctionExpression") {
          body.push({
            type: "ExpressionStatement",
            expression: visited as estree.Expression
          });
        } else if (type === "ExpressionStatement") {
          body.push(visited as estree.ExpressionStatement);
        }
      }
    }
    
    this.inProgramContext = false;
    
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

  visitList(node: ast.ListNode): estree.Expression | estree.Statement | estree.Statement[] {
    if (node.nodes.length === 0) {
      return {
        type: "ArrayExpression",
        elements: []
      };
    }

    // Skip leading comments to find the first real node
    let firstNodeIdx = 0;
    while (firstNodeIdx < node.nodes.length && node.nodes[firstNodeIdx]._type === "comment") {
      firstNodeIdx++;
    }
    
    // If all nodes are comments, return empty array
    if (firstNodeIdx >= node.nodes.length) {
      return [];
    }
    
    const firstNode = node.nodes[firstNodeIdx];
    const firstNodeType = firstNode._type;
    
    // Check if the first item is statement-like
    // If so, treat the entire list as a statement sequence
    if (this.isStatementLike(firstNode)) {
      // Special case: if the list is a single statement-keyword call
      if (node.nodes.length > 0 && firstNode._type === "simple-identifier") {
        const firstId = (firstNode as ast.SimpleIdentifierNode).id;
        
        // Handle return statement
        if (firstId === "return") {
          const arg = node.nodes.length > firstNodeIdx + 1 ? (this.visit(node.nodes[firstNodeIdx + 1]) as estree.Expression) : null;
          return {
            type: "ReturnStatement",
            argument: arg
          };
        }
        
        // Handle throw statement
        if (firstId === "throw") {
          const arg = node.nodes.length > firstNodeIdx + 1 ? (this.visit(node.nodes[firstNodeIdx + 1]) as estree.Expression) : { type: "Literal", value: null, raw: "null" } as estree.Expression;
          return {
            type: "ThrowStatement",
            argument: arg
          };
        }
      }
      
      // General case: sequence of statements
      const statements: estree.Statement[] = [];
      for (const item of node.nodes) {
        // Skip comments
        if (item._type === "comment") {
          continue;
        }
        
        const visited = this.visit(item);
        if (!visited) continue;
        
        if (Array.isArray(visited)) {
          statements.push(...(visited.filter((v): v is estree.Statement => v !== null)));
        } else if ((visited as any).type?.endsWith("Statement") || (visited as any).type?.endsWith("Declaration")) {
          statements.push(visited as estree.Statement);
        } else if ((visited as any).type === "FunctionExpression") {
          // Convert function expressions to expression statements
          statements.push({
            type: "ExpressionStatement",
            expression: visited as estree.Expression
          });
        } else if ((visited as any).type === "CallExpression" || (visited as any).type === "AssignmentExpression") {
          statements.push({
            type: "ExpressionStatement",
            expression: visited as estree.Expression
          });
        } else if ((visited as any).type === "Identifier") {
          // Handle standalone statement keyword identifiers
          const id = (item as ast.SimpleIdentifierNode).id;
          if (id === "return") {
            statements.push({
              type: "ReturnStatement",
              argument: null
            });
          }
        }
      }
      return statements.length === 1 ? statements[0] : statements;
    }
    
    // Check if this is a function call
    if (firstNodeType === "simple-identifier" || firstNodeType === "composite-identifier") {
      const visitedNodes = node.nodes.map((n) => {
        return this.visit(n);
      });
      const [callee, ...args] = visitedNodes;
      const calleeIdent = callee as estree.Identifier | estree.MemberExpression;
      
      const filteredArgs = args.filter((a): a is estree.Expression => {
        return a !== null && !Array.isArray(a) && ("type" in (a as any));
      });
      
      const callExpr: estree.CallExpression = {
        type: "CallExpression",
        callee: calleeIdent,
        arguments: filteredArgs,
        optional: false
      };
      
      return callExpr;
    }
    
    // Otherwise, it's an array literal
    const visitedNodes = node.nodes.map(n => this.visit(n));
    const elements = visitedNodes.filter((v): v is estree.Expression => {
      return v !== null && !Array.isArray(v) && ("type" in (v as any));
    });
    
    return {
      type: "ArrayExpression",
      elements
    };
  }

  /**
   * Check if a node represents a statement-like operation
   */
  private isStatementLike(node: ast.ASTNode): boolean {
    // Check if node is directly a statement type
    const statementTypes = [
      "function",
      "variable",
      "if",
      "while",
      "for",
      "foreach",
      "match",
      "when",
      "cond",
      "try-catch",
      "class",
      "interface",
      "simple-assignment",
      "compound-assignment",
      "return"
    ];
    
    if (statementTypes.includes(node._type)) {
      return true;
    }
    
    // Check if it's an identifier that represents a statement keyword
    if (node._type === "simple-identifier") {
      const id = (node as ast.SimpleIdentifierNode).id;
      const statementKeywords = ["let", "var", "class", "if", "when", "cond", "while", "for", "foreach", "match", "return", "try", "throw"];
      return statementKeywords.includes(id);
    }
    
    // Check if it's a list that starts with a statement or statement keyword
    if (node._type === "list") {
      const listNode = node as ast.ListNode;
      if (listNode.nodes.length > 0) {
        const firstItem = listNode.nodes[0];
        
        // Check if first item is a statement node type
        if (statementTypes.includes(firstItem._type)) {
          return true;
        }
        
        // Check if first item is an identifier that's a statement keyword
        if (firstItem._type === "simple-identifier") {
          const id = (firstItem as ast.SimpleIdentifierNode).id;
          const statementKeywords = ["let", "var", "class", "if", "when", "cond", "while", "for", "foreach", "match", "return", "try", "throw", "defclass"];
          return statementKeywords.includes(id);
        }
      }
    }
    
    return false;
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
        let valueNode = this.visit(kvNode.value) as estree.Expression | estree.Statement;
        
        // If valueNode is an ExpressionStatement, unwrap it to get the expression
        if ((valueNode as any).type === "ExpressionStatement") {
          valueNode = (valueNode as estree.ExpressionStatement).expression;
        }
        
        const computed = keyNode.type !== "Identifier" && keyNode.type !== "Literal";
        
        return {
          type: "Property" as const,
          kind: "init" as const,
          key: keyNode,
          value: valueNode as estree.Expression,
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

    // Build a nested conditional expression (ternary operator)
    let conditional: estree.Expression = { type: "Identifier", name: "undefined" }; // Default value if no case matches

    for (let i = node.cases.length - 1; i >= 0; i--) {
        const matchCase = node.cases[i];
        const pattern = matchCase.pattern;
        let test: estree.Expression;

        if (pattern._type === "constant-pattern") {
            test = {
                type: "BinaryExpression",
                operator: "===",
                left: discriminant,
                right: this.visit((pattern as ast.ConstantPatternNode).constant) as estree.Expression
            };
        } else if (pattern._type === "any-pattern") {
            test = { type: "Literal", value: true, raw: "true" };
        } else {
            this.context.log(LogLevel.Warning, `Complex pattern matching not yet fully implemented for ${pattern._type}`);
            test = { type: "Literal", value: true, raw: "true" };
        }

        let consequent = this.visit(matchCase.body) as estree.Expression | estree.Statement | null;
        
        // Handle case where body visits to a statement, array, or null
        if (!consequent) {
          consequent = { type: "Identifier", name: "undefined" };
        } else if (Array.isArray(consequent)) {
          // If it's an array of statements, wrap in IIFE
          consequent = {
            type: "CallExpression",
            callee: {
              type: "ArrowFunctionExpression",
              params: [],
              body: {
                type: "BlockStatement",
                body: consequent as estree.Statement[]
              },
              expression: false
            },
            arguments: [],
            optional: false
          };
        } else if ((consequent as any).type && (consequent as any).type.endsWith("Statement") && (consequent as any).type !== "ExpressionStatement") {
          // If it's a non-expression statement, wrap in IIFE that returns undefined
          consequent = {
            type: "CallExpression",
            callee: {
              type: "ArrowFunctionExpression",
              params: [],
              body: {
                type: "BlockStatement",
                body: [consequent as estree.Statement]
              },
              expression: false
            },
            arguments: [],
            optional: false
          };
        } else if ((consequent as any).type === "ExpressionStatement") {
          // Unwrap ExpressionStatement to get the expression
          consequent = (consequent as estree.ExpressionStatement).expression;
        }

        // Ensure consequent is always an expression
        let consequentExpr: estree.Expression;
        if (!consequent || (consequent as any).type === "undefined") {
          consequentExpr = { type: "Identifier", name: "undefined" };
        } else if (typeof consequent === "object" && "type" in consequent && (consequent as any).type.endsWith("Expression")) {
          consequentExpr = consequent as estree.Expression;
        } else {
          // Shouldn't happen, but fallback to undefined
          consequentExpr = { type: "Identifier", name: "undefined" };
        }

        conditional = {
            type: "ConditionalExpression",
            test,
            consequent: consequentExpr,
            alternate: conditional
        };
    }

    // Wrap in an IIFE to ensure it's treated as an expression
    return {
        type: "CallExpression",
        callee: {
            type: "ArrowFunctionExpression",
            params: [],
            body: {
                type: "BlockStatement",
                body: [{
                    type: "ReturnStatement",
                    argument: conditional
                }]
            },
            expression: false
        },
        arguments: [],
        optional: false
    };
  }

  visitWhen(node: ast.WhenNode): estree.IfStatement {
    const test = this.visit(node.condition!) as estree.Expression;
    const bodyStmts: estree.Statement[] = [];
    
    for (const stmt of node.then) {
      const visited = this.visit(stmt);
      if (!visited) continue;
      
      // Handle return as a special case
      if (stmt._type === "simple-identifier" && (stmt as ast.SimpleIdentifierNode).id === "return") {
        bodyStmts.push({
          type: "ReturnStatement",
          argument: null
        });
      } else if ((visited as any).type?.endsWith("Statement") || (visited as any).type?.endsWith("Declaration")) {
        bodyStmts.push(visited as estree.Statement);
      } else if ((visited as any).type === "CallExpression" || (visited as any).type === "AssignmentExpression") {
        bodyStmts.push({
          type: "ExpressionStatement",
          expression: visited as estree.Expression
        });
      } else if ((visited as any).type === "ExpressionStatement") {
        bodyStmts.push(visited as estree.ExpressionStatement);
      }
    }
    
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
    
    // Convert body nodes to statements
    const bodyStatements: estree.Statement[] = [];
    
    for (const bodyItem of node.body) {
      const visited = this.visit(bodyItem);
      if (!visited) continue;
      
      // Handle statement arrays (flattened statement lists)
      if (Array.isArray(visited)) {
        for (const item of visited) {
          if (!item) continue;
          if ((item as any).type && ((item as any).type?.endsWith("Declaration") || (item as any).type?.endsWith("Statement"))) {
            bodyStatements.push(item as estree.Statement);
          } else if ((item as any).type === "CallExpression" || (item as any).type === "AssignmentExpression") {
            bodyStatements.push({
              type: "ExpressionStatement",
              expression: item as estree.Expression
            });
          }
        }
      }
      // Handle different node types
      else if ((visited as any).type === "BlockStatement") {
        bodyStatements.push(visited as estree.BlockStatement);
      } else if ((visited as any).type?.endsWith("Declaration") || (visited as any).type?.endsWith("Statement")) {
        bodyStatements.push(visited as estree.Statement);
      } else if ((visited as any).type === "ExpressionStatement") {
        bodyStatements.push(visited as estree.ExpressionStatement);
      } else if ("type" in (visited as any) && ((visited as any).type === "CallExpression" || (visited as any).type === "AssignmentExpression")) {
        // Wrap expressions in ExpressionStatement
        bodyStatements.push({
          type: "ExpressionStatement",
          expression: visited as estree.Expression
        });
      }
      // Skip ArrayExpressions - they shouldn't be function body statements
    }
    
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
    const id = node.name ? (this.visit(node.name) as estree.Identifier) : ({ type: "Identifier", name: "AnonymousClass" } as estree.Identifier);
    const superClass = node.extends && node.extends.length > 0 ? this.visit(node.extends[0].type) as estree.Expression : null;
    
    const body: estree.ClassBody = {
      type: "ClassBody",
      body: node.body.flatMap(member => {
        // Unwrap lists that wrap single members (common in Lisp)
        const actualMember = (member._type === "list") ? (member as ast.ListNode).nodes[0] : member;
        
        if (actualMember._type === "function") {
          const fn = actualMember as ast.FunctionNode;
          const key = this.visit(fn.name!) as estree.Identifier;
          const params = fn.params.map(p => this.visit(p) as estree.Pattern);
          
          // Convert body nodes to statements (similar to visitFunction)
          const bodyStatements: estree.Statement[] = [];
          for (const bodyItem of fn.body) {
            const visited = this.visit(bodyItem);
            if (!visited) continue;
            
            // Handle statement arrays (flattened statement lists)
            if (Array.isArray(visited)) {
              for (const item of visited) {
                if (!item) continue;
                if ((item as any).type && ((item as any).type?.endsWith("Declaration") || (item as any).type?.endsWith("Statement"))) {
                  bodyStatements.push(item as estree.Statement);
                } else if ((item as any).type === "CallExpression" || (item as any).type === "AssignmentExpression") {
                  bodyStatements.push({
                    type: "ExpressionStatement",
                    expression: item as estree.Expression
                  });
                }
              }
            }
            // Handle different node types
            else if ((visited as any).type === "BlockStatement") {
              bodyStatements.push(visited as estree.BlockStatement);
            } else if ((visited as any).type?.endsWith("Declaration") || (visited as any).type?.endsWith("Statement")) {
              bodyStatements.push(visited as estree.Statement);
            } else if ((visited as any).type === "ExpressionStatement") {
              bodyStatements.push(visited as estree.ExpressionStatement);
            } else if ("type" in (visited as any) && ((visited as any).type === "CallExpression" || (visited as any).type === "AssignmentExpression")) {
              // Wrap expressions in ExpressionStatement
              bodyStatements.push({
                type: "ExpressionStatement",
                expression: visited as estree.Expression
              });
            }
          }
          
          const fnBody: estree.BlockStatement = {
            type: "BlockStatement",
            body: bodyStatements
          };
          
          return [{
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
          } as estree.MethodDefinition];
        } else if (actualMember._type === "variable") {
          const varNode = actualMember as ast.VariableNode;
          const key = this.visit(varNode.name) as estree.Identifier;
          
          return [{
            type: "PropertyDefinition",
            key,
            value: varNode.value ? this.visit(varNode.value) as estree.Expression : null,
            computed: false,
            static: false
          } as any];  // PropertyDefinition not in estree yet
        }
        return [];
      })
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
    
    // Process value array - mix of StringNodes and FormatExpressionNodes
    for (let i = 0; i < node.value.length; i++) {
      const part = node.value[i];
      
      if (part._type === "string") {
        const stringNode = part as ast.StringNode;
        quasis.push({
          type: "TemplateElement",
          value: { raw: stringNode.value, cooked: stringNode.value },
          tail: i === node.value.length - 1 && expressions.length === quasis.length
        });
      } else if (part._type === "format-expression") {
        const exprNode = this.visit(part) as estree.Expression;
        expressions.push(exprNode);
        // Add empty quasi for template literal structure
        if (quasis.length === expressions.length - 1) {
          quasis.push({
            type: "TemplateElement",
            value: { raw: "", cooked: "" },
            tail: i === node.value.length - 1
          });
        }
      }
    }
    
    // Ensure we have proper quasi/expression pairing
    if (quasis.length === expressions.length) {
      quasis.push({
        type: "TemplateElement",
        value: { raw: "", cooked: "" },
        tail: true
      });
    }
    
    return {
      type: "TemplateLiteral",
      quasis,
      expressions
    };
  }

  visitFormatExpression(node: ast.FormatExpressionNode): estree.Expression {
    const expression = node.expression;
    if (expression._type === 'list') {
      const listNode = expression as ast.ListNode;
      if (listNode.nodes.length === 1 && listNode.nodes[0]._type === 'simple-identifier') {
        return this.visit(listNode.nodes[0]) as estree.Expression;
      }
    }
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

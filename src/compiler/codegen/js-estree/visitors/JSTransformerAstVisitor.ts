import * as ESTree from "estree";
import { generate } from "astring";

import * as ast from "../../../frontend/ast";
import { BaseAstVisitor } from "../../../BaseAstVisitor";
import { Context, LogLevel, VERSION } from "../../../Context";
import { ScopeType, SymbolEntry } from "../../../analysis/SymbolTable";
import { RuntimeProvider } from "../../../runtime";
import {
  uniqueIdentifier,
  encodeIdentifier,
} from "../../../utils";
import { ClassBuilder } from "../JSClassBuilder";

/**
 * Helper to extract variable names declared within a pattern match
 */
function findIdentifiersToDefine(node: ast.MatchNode): string[] {
  const predefinedVariables: string[] = [];
  const walkPattern = (p: ast.PatternNode): boolean => {
    switch (p._type) {
      case "identifier-pattern":
        if (!RuntimeProvider.isRuntimeReference(p.id.id)) {
          predefinedVariables.push(encodeIdentifier(p.id.id));
        }
        return true;
      case "map-pattern":
        return (p as ast.MapPatternNode).pairs.every((x) =>
          walkPattern(x.pattern)
        );
      case "list-pattern":
      case "vector-pattern":
        return (p as ast.ListPatternNode).elements.every((x) => walkPattern(x));
      default:
        return true;
    }
  };
  node.cases.every((x) => walkPattern(x.pattern));
  return Array.from(new Set(predefinedVariables));
}

/**
 * ESTree node creation helpers with location tracking
 */
class ESTreeBuilder {
  static loc(node: ast.ASTNode): ESTree.SourceLocation | null {
    if (!node._location) return null;
    return {
      source: node._location.source,
      start: {
        line: node._location.start.line,
        column: node._location.start.column,
      },
      end: {
        line: node._location.end.line,
        column: node._location.end.column,
      },
    };
  }

  static identifier(node: ast.ASTNode, name: string): ESTree.Identifier {
    return {
      type: "Identifier",
      name,
      loc: this.loc(node),
    };
  }

  static literal(node: ast.ASTNode, value: any): ESTree.Literal {
    return {
      type: "Literal",
      value,
      loc: this.loc(node),
    };
  }

  static memberExpression(
    node: ast.ASTNode,
    object: ESTree.Expression,
    property: ESTree.Expression | ESTree.Identifier,
    computed: boolean = false
  ): ESTree.MemberExpression {
    return {
      type: "MemberExpression",
      object,
      property,
      computed,
      optional: false,
      loc: this.loc(node),
    };
  }

  static callExpression(
    node: ast.ASTNode,
    callee: ESTree.Expression,
    args: ESTree.Expression[]
  ): ESTree.CallExpression {
    return {
      type: "CallExpression",
      callee,
      arguments: args,
      optional: false,
      loc: this.loc(node),
    };
  }

  static blockStatement(
    node: ast.ASTNode,
    body: ESTree.Statement[]
  ): ESTree.BlockStatement {
    return {
      type: "BlockStatement",
      body,
      loc: this.loc(node),
    };
  }

  static expressionStatement(
    node: ast.ASTNode,
    expression: ESTree.Expression
  ): ESTree.ExpressionStatement {
    return {
      type: "ExpressionStatement",
      expression,
      loc: this.loc(node),
    };
  }

  static returnStatement(
    node: ast.ASTNode,
    argument: ESTree.Expression | null
  ): ESTree.ReturnStatement {
    return {
      type: "ReturnStatement",
      argument,
      loc: this.loc(node),
    };
  }

  static sequenceExpression(
    node: ast.ASTNode,
    expressions: ESTree.Expression[]
  ): ESTree.SequenceExpression {
    return {
      type: "SequenceExpression",
      expressions,
      loc: this.loc(node),
    };
  }
}

export class JSTransformerAstVisitor extends BaseAstVisitor {
  private scope: ScopeType[] = [ScopeType.program];

  public functions: string[] = [];
  public classes: string[] = [];
  public variables: string[] = [];

  private enumKeys: Record<string, string> = {};
  private identifiersCache: Record<string, string> = {};
  private inlineStandardSymbols: string[] = [];
  private inlinedSymbols: Record<string, string> = {};
  private inlinedDefinitions: Record<string, ESTree.Statement> = {};
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

  private isExpressionContext(): boolean {
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
  // Core Compilation
  // =========================================================================

  public compile(root: ast.ASTNode) {
    this.rootSource = root?._location?.source;
    const program = this.visit(root) as ESTree.Program;

    // Prepend runtime shim if needed
    const runtimeShim = RuntimeProvider.getRuntimeShimForSymbols(
      this.inlineStandardSymbols
    );

    // Add header comment
    const header: ESTree.Program = {
      type: "Program",
      sourceType: "script",
      body: [
        {
          type: "ExpressionStatement",
          expression: {
            type: "Literal",
            value: "use strict",
          },
          directive: "use strict",
        } as ESTree.Directive,
        {
          type: "ExpressionStatement",
          expression: {
            type: "Literal",
            raw: runtimeShim,
          },
        } as ESTree.Statement,
      ],
    };

    // Prepend inlined definitions
    const inlinedDefs = Object.values(this.inlinedDefinitions);

    // Wrap everything in IIFE
    const wrappedBody: ESTree.ExpressionStatement = {
      type: "ExpressionStatement",
      expression: {
        type: "CallExpression",
        callee: {
          type: "FunctionExpression",
          id: null,
          params: [],
          body: {
            type: "BlockStatement",
            // @ts-expect-error
            body: [...inlinedDefs, ...program.body],
          },
          generator: false,
          async: false,
        },
        arguments: [],
        optional: false,
      },
    };

    const finalProgram: ESTree.Program = {
      type: "Program",
      sourceType: "script",
      body: [...header.body, wrappedBody],
    };

    // Generate code with astring
    const code = generate(finalProgram, {
      comments: true,
      indent: "  ",
    });

    return {
      code,
      map: null, // TODO: Generate source map from ESTree
    };
  }

  visitProgram(node: ast.ProgramNode): ESTree.Program {
    const statements: ESTree.Statement[] = [];

    for (const n of node.program) {
      const result = this.visit(n);
      if (result) {
        if (this.isStatement(result)) {
          statements.push(result as ESTree.Statement);
        } else {
          statements.push(
            ESTreeBuilder.expressionStatement(n, result as ESTree.Expression)
          );
        }
      }
    }

    return {
      type: "Program",
      sourceType: "script",
      body: statements,
    };
  }

  // =========================================================================
  // Classes
  // =========================================================================

  visitClass(node: ast.ClassNode): ESTree.ClassDeclaration {
    this.classes.push(node.name.name);

    return this.runInScope(ScopeType.class, () => {
      const classBuilder = new ClassBuilder(node, this.context, this);
      return classBuilder.build();
    });
  }

  visitStruct(node: ast.StructNode): ESTree.ClassDeclaration {
    return this.visitClass(node as unknown as ast.ClassNode);
  }

  visitEnum(node: ast.EnumNode): ESTree.VariableDeclaration {
    const enumName = node.name.name;
    const declarations: ESTree.VariableDeclarator[] = [];

    node.body.forEach((keyNode, keyIndex) => {
      const key = `${enumName}:${keyNode.key.id ?? keyNode.key.value}`;
      const value =
        keyNode.value !== null
          ? (this.visit(keyNode.value) as ESTree.Expression)
          : ESTreeBuilder.literal(keyNode, keyIndex);

      this.enumKeys[key] = value.toString();

      declarations.push({
        type: "VariableDeclarator",
        id: ESTreeBuilder.identifier(keyNode, encodeIdentifier(key)),
        init: value,
      });
    });

    return {
      type: "VariableDeclaration",
      kind: "const",
      declarations,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitInterface(node: ast.InterfaceNode): ESTree.EmptyStatement {
    return this.runInScope(ScopeType.interface, () => ({
      type: "EmptyStatement",
      loc: ESTreeBuilder.loc(node),
    }));
  }

  // =========================================================================
  // Functions & Variables
  // =========================================================================

  visitFunction(
    node: ast.FunctionNode
  ):
    | ESTree.FunctionDeclaration
    | ESTree.VariableDeclaration
    | ESTree.MethodDefinition
    | ESTree.ArrowFunctionExpression {
    const nextScope = this.inScope(ScopeType.class)
      ? ScopeType.method
      : ScopeType.function;

    return this.runInScope(nextScope, () => {
      const name = node.name
        ? (this.visit(node.name) as ESTree.Identifier)
        : null;
      if (name) {
        this.functions.push(name.name);
      }

      const params = node.params.map((x) => this.visit(x) as ESTree.Pattern);

      // Process function body with implicit return
      const bodyStatements: ESTree.Statement[] = [];

      node.body.forEach((x, index) => {
        const visited = this.visit(x);
        const isLast = index === node.body.length - 1;

        if (
          isLast &&
          !this.isReturnStatement(visited) &&
          !this.isControlStatement(visited) &&
          x._type !== "variable"
        ) {
          if (this.isExpression(visited)) {
            bodyStatements.push(
              ESTreeBuilder.returnStatement(x, visited as ESTree.Expression)
            );
          } else {
            bodyStatements.push(visited as ESTree.Statement);
          }
        } else {
          if (this.isStatement(visited)) {
            bodyStatements.push(visited as ESTree.Statement);
          } else {
            bodyStatements.push(
              ESTreeBuilder.expressionStatement(x, visited as ESTree.Expression)
            );
          }
        }
      });

      const body = ESTreeBuilder.blockStatement(node, bodyStatements);

      // Determine function form based on scope
      if (this.currentScope() === ScopeType.method) {
        return {
          type: "MethodDefinition",
          key: name!,
          value: {
            type: "FunctionExpression",
            id: null,
            params,
            body,
            generator: false,
            async: node.async,
          },
          kind: "method",
          computed: false,
          static: false,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.MethodDefinition;
      } else if (this.scope[1] === ScopeType.program) {
        return {
          type: "FunctionDeclaration",
          id: name,
          params,
          body,
          generator: false,
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.FunctionDeclaration;
      } else {
        const funcExpr: ESTree.ArrowFunctionExpression = {
          type: "ArrowFunctionExpression",
          params,
          body,
          expression: true,
          generator: false,
          async: node.async,
          loc: ESTreeBuilder.loc(node),
        };

        if (name) {
          return {
            type: "VariableDeclaration",
            kind: "const",
            declarations: [
              {
                type: "VariableDeclarator",
                id: name,
                init: funcExpr,
              },
            ],
            loc: ESTreeBuilder.loc(node),
          };
        }

        console.log(this.context.astProvider.getSource(node._location));
        return funcExpr as any;
      }
    });
  }

  private transformPipelineList(
    nodes: ast.ASTNode[]
  ): ESTree.Expression | null {
    if (nodes.length < 3) return null;

    const firstOpNode = nodes[1];
    let isBackward = false;

    if (firstOpNode._type === "simple-identifier") {
      const id = (firstOpNode as ast.SimpleIdentifierNode).id;
      if (id === "<|") isBackward = true;
      else if (id !== "|>") return null;
    } else {
      return null;
    }

    let processingNodes: ast.ASTNode[] = [];

    if (isBackward) {
      const seed = nodes[nodes.length - 1];
      processingNodes.push(seed);
      for (let i = nodes.length - 2; i >= 0; i -= 2) {
        const func = nodes[i - 1];
        processingNodes.push({ _type: "simple-identifier", id: "|>" } as any);
        processingNodes.push(func);
      }
    } else {
      processingNodes = nodes;
    }

    const seed = processingNodes[0];
    let current = this.visit(seed) as ESTree.Expression;

    for (let i = 1; i < processingNodes.length; i += 2) {
      const funcNode = processingNodes[i + 1];
      if (!funcNode) return null;

      let functionNode: ast.ASTNode;
      let args: ast.ASTNode[] = [];
      let member = false;

      if (funcNode._type === "list") {
        const listNodes = (funcNode as ast.ListNode).nodes;
        if (listNodes.length > 0) {
          functionNode = listNodes[0];
          args = listNodes.slice(1);

          if (
            functionNode._type === "simple-identifier" &&
            (functionNode as any).id.startsWith(".")
          ) {
            member = true;
            const rawId = (functionNode as any).id.substring(1);
            functionNode = { ...functionNode, id: rawId } as any;
          }
        } else {
          return null;
        }
      } else if (
        funcNode._type === "simple-identifier" ||
        funcNode._type === "composite-identifier"
      ) {
        functionNode = funcNode;

        if (
          funcNode._type === "simple-identifier" &&
          (funcNode as any).id.startsWith(".")
        ) {
          member = true;
          const rawId = (funcNode as any).id.substring(1);
          functionNode = { ...funcNode, id: rawId } as any;
        }
      } else {
        functionNode = funcNode;
      }

      const fn = this.visit(functionNode) as ESTree.Expression;
      const argExprs = args.map((a) => this.visit(a) as ESTree.Expression);

      if (member) {
        current = ESTreeBuilder.callExpression(
          funcNode,
          ESTreeBuilder.memberExpression(
            funcNode,
            current,
            fn as ESTree.Identifier
          ),
          argExprs
        );
      } else {
        current = ESTreeBuilder.callExpression(funcNode, fn, [
          current,
          ...argExprs,
        ]);
      }
    }

    return current;
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode): ESTree.Expression {
    const flatSequence: any[] = [];
    let current = this.visit(node.identifier) as ESTree.Expression;

    const collectSteps = (sequence: any[]) => {
      for (const seq of sequence) {
        if (
          seq.arguments.length > 0 &&
          seq.arguments[0]._type === "function-carrying"
        ) {
          const nestedNode = seq.arguments[0] as ast.FunctionCarryingNode;
          const realArg = nestedNode.identifier;
          flatSequence.push({
            ...seq,
            arguments: [realArg, ...seq.arguments.slice(1)],
          });
          collectSteps(nestedNode.sequence);
        } else {
          flatSequence.push(seq);
        }
      }
    };

    collectSteps(node.sequence);

    for (const seq of flatSequence) {
      const fn = this.visit(seq.function) as ESTree.Expression;
      const args = seq.arguments.map(
        (a: ast.ASTNode) => this.visit(a) as ESTree.Expression
      );

      if (seq.operator === "carrying-left") {
        if (seq.memberFunction) {
          current = ESTreeBuilder.callExpression(
            seq.function,
            ESTreeBuilder.memberExpression(
              seq.function,
              current,
              fn as ESTree.Identifier
            ),
            args
          );
        } else {
          current = ESTreeBuilder.callExpression(seq.function, fn, [
            current,
            ...args,
          ]);
        }
      } else {
        if (seq.memberFunction) {
          current = ESTreeBuilder.callExpression(
            seq.function,
            ESTreeBuilder.memberExpression(
              seq.function,
              current,
              fn as ESTree.Identifier
            ),
            args
          );
        } else {
          current = ESTreeBuilder.callExpression(seq.function, fn, [
            ...args,
            current,
          ]);
        }
      }
    }

    return current;
  }

  visitVariable(node: ast.VariableNode): ESTree.VariableDeclaration {
    this.pushScope(ScopeType.variable);
    const name = this.visit(node.name) as ESTree.Identifier;
    const value = node.value
      ? (this.visit(node.value) as ESTree.Expression)
      : null;
    this.popScope();

    this.variables.push(name.name);

    return {
      type: "VariableDeclaration",
      kind: node.mutable ? "let" : "const",
      declarations: [
        {
          type: "VariableDeclarator",
          id: name,
          init: value,
        },
      ],
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitParameter(node: ast.ParameterNode): ESTree.Identifier {
    return this.visit(node.name) as ESTree.Identifier;
  }

  // =========================================================================
  // Control Flow
  // =========================================================================

  visitIf(node: ast.IfNode): ESTree.IfStatement | ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.if, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const thenBranch = this.visit(node.then!);
      const elseBranch = node.else ? this.visit(node.else) : null;

      if (this.isExpressionContext()) {
        return {
          type: "ConditionalExpression",
          test: condition,
          consequent: thenBranch as ESTree.Expression,
          alternate:
            (elseBranch as ESTree.Expression) ||
            ESTreeBuilder.identifier(node, "undefined"),
          loc: ESTreeBuilder.loc(node),
        } as ESTree.ConditionalExpression;
      }

      const consequent = this.isStatement(thenBranch)
        ? (thenBranch as ESTree.Statement)
        : ESTreeBuilder.blockStatement(node.then!, [
            ESTreeBuilder.expressionStatement(
              node.then!,
              thenBranch as ESTree.Expression
            ),
          ]);

      const alternate = elseBranch
        ? this.isStatement(elseBranch)
          ? (elseBranch as ESTree.Statement)
          : ESTreeBuilder.blockStatement(node.else!, [
              ESTreeBuilder.expressionStatement(
                node.else!,
                elseBranch as ESTree.Expression
              ),
            ])
        : null;

      return {
        type: "IfStatement",
        test: condition,
        consequent,
        alternate,
        loc: ESTreeBuilder.loc(node),
      } as ESTree.IfStatement;
    });
  }

  visitWhen(node: ast.WhenNode): ESTree.ConditionalExpression {
    return this.runInScope(ScopeType.when, () => {
      const condition = this.visit(node.condition!) as ESTree.Expression;
      const whenExprs = node.then!.map(
        (x) => this.visit(x) as ESTree.Expression
      );

      return {
        type: "ConditionalExpression",
        test: condition,
        consequent:
          whenExprs.length === 1
            ? whenExprs[0]
            : ESTreeBuilder.sequenceExpression(node, whenExprs),
        alternate: ESTreeBuilder.identifier(node, "undefined"),
        loc: ESTreeBuilder.loc(node),
      };
    });
  }

  visitCond(node: ast.CondNode): ESTree.Expression | ESTree.SwitchStatement {
    const cases = node.cases.map((c) => this.visit(c));

    if (this.isExpressionContext()) {
      // Build nested ternary
      let result: ESTree.Expression = ESTreeBuilder.identifier(
        node,
        "undefined"
      );
      for (let i = cases.length - 1; i >= 0; i--) {
        result = cases[i] as ESTree.ConditionalExpression;
        if (i > 0) {
          (cases[i - 1] as any).alternate = result;
        }
      }
      return result;
    }

    return {
      type: "SwitchStatement",
      discriminant: ESTreeBuilder.literal(node, true),
      cases: cases as ESTree.SwitchCase[],
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitCondCase(
    node: ast.CondCaseNode
  ): ESTree.ConditionalExpression | ESTree.SwitchCase {
    const cond = this.visit(node.condition) as ESTree.Expression;
    const body = this.visit(node.body);

    if (this.isExpressionContext()) {
      return {
        type: "ConditionalExpression",
        test: cond,
        consequent: body as ESTree.Expression,
        alternate: ESTreeBuilder.identifier(node, "undefined"),
        loc: ESTreeBuilder.loc(node),
      };
    }

    const bodyStmt = this.isStatement(body)
      ? [body as ESTree.Statement, { type: "BreakStatement", label: null }]
      : [
          ESTreeBuilder.expressionStatement(
            node.body,
            body as ESTree.Expression
          ),
          { type: "BreakStatement", label: null },
        ];

    return {
      type: "SwitchCase",
      test: cond,
      consequent: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    } as ESTree.SwitchCase;
  }

  visitWhile(node: ast.WhileNode): ESTree.WhileStatement {
    const condition = this.visit(node.condition) as ESTree.Expression;
    const body = this.visit(node.then);

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

    return {
      type: "WhileStatement",
      test: condition,
      body: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitFor(node: ast.ForNode): ESTree.BlockStatement {
    const init = this.visit(node.initial) as ESTree.Statement;
    const test = this.visit(node.condition) as ESTree.Expression;
    const update = this.visit(node.step) as ESTree.Expression;
    const body = this.visit(node.then);
    const elseFor =
      node.else !== null ? (this.visit(node.else) as ESTree.Statement) : null;

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

    const forStmt: ESTree.ForStatement = {
      type: "ForStatement",
      test,
      update,
      body: bodyStmt,
      loc: ESTreeBuilder.loc(node),
    };

    const statements: ESTree.Statement[] = [init, forStmt];
    if (elseFor) statements.push(elseFor);

    return ESTreeBuilder.blockStatement(node, statements);
  }

  visitForEach(node: ast.ForEachNode): ESTree.BlockStatement {
    const variable = this.visit(node.variable) as ESTree.Identifier;
    const collection = this.visit(node.collection) as ESTree.Expression;
    const body = this.visit(node.then);
    const elseFor =
      node.else !== null ? (this.visit(node.else) as ESTree.Statement) : null;

    const bodyStmt = this.isStatement(body)
      ? (body as ESTree.Statement)
      : ESTreeBuilder.blockStatement(node.then, [
          ESTreeBuilder.expressionStatement(
            node.then,
            body as ESTree.Expression
          ),
        ]);

    const forOfStmt: ESTree.ForOfStatement = {
      type: "ForOfStatement",
      left: {
        type: "VariableDeclaration",
        kind: "let",
        declarations: [
          {
            type: "VariableDeclarator",
            id: variable,
            init: null,
          },
        ],
      },
      right: collection,
      body: bodyStmt,
      await: false,
      loc: ESTreeBuilder.loc(node),
    };

    const statements: ESTree.Statement[] = [forOfStmt];
    if (elseFor) statements.push(elseFor);

    return ESTreeBuilder.blockStatement(node, statements);
  }

  visitTryCatch(node: ast.TryCatchNode): ESTree.TryStatement {
    const tryBlock = ESTreeBuilder.blockStatement(node.try, [
      this.visit(node.try) as ESTree.Statement,
    ]);

    const catchVar = uniqueIdentifier("tmp_catch_id");
    const catchVarId = ESTreeBuilder.identifier(node, catchVar);

    let catchClause: ESTree.CatchClause | null = null;

    if (node.catch && node.catch.length > 0) {
      const catchStatements: ESTree.Statement[] = [];

      const filteredCatches = node.catch.filter((x) => !!x.filter);
      for (const c of filteredCatches) {
        const filterVar = this.visit(c.filter.name) as ESTree.Identifier;
        const filterType = this.visit(c.filter.type) as ESTree.Identifier;
        const catchBody = this.visit(c.body) as ESTree.Statement;

        catchStatements.push({
          type: "IfStatement",
          test: {
            type: "BinaryExpression",
            operator: "instanceof",
            left: catchVarId,
            right: filterType,
          },
          consequent: ESTreeBuilder.blockStatement(c.body, [
            {
              type: "VariableDeclaration",
              kind: "const",
              declarations: [
                {
                  type: "VariableDeclarator",
                  id: filterVar,
                  init: catchVarId,
                },
              ],
            },
            catchBody,
          ]),
          alternate: null,
        } as ESTree.IfStatement);
      }

      const defaultCatch = node.catch.find((x) => !x.filter);
      if (defaultCatch) {
        catchStatements.push(this.visit(defaultCatch.body) as ESTree.Statement);
      } else {
        catchStatements.push({
          type: "ThrowStatement",
          argument: catchVarId,
        } as ESTree.ThrowStatement);
      }

      catchClause = {
        type: "CatchClause",
        param: catchVarId,
        body: ESTreeBuilder.blockStatement(node, catchStatements),
      };
    }

    const finallyBlock = node.finally
      ? ESTreeBuilder.blockStatement(node.finally, [
          this.visit(node.finally) as ESTree.Statement,
        ])
      : null;

    return {
      type: "TryStatement",
      block: tryBlock,
      handler: catchClause,
      finalizer: finallyBlock,
      loc: ESTreeBuilder.loc(node),
    };
  }

  // =========================================================================
  // Pattern Matching
  // =========================================================================

  visitMatch(node: ast.MatchNode): ESTree.CallExpression {
    return this.runInScope(ScopeType.match, () => {
      const matchVar = uniqueIdentifier("tmp_match_id");
      const matchVarId = ESTreeBuilder.identifier(node, matchVar);
      const matchVal = this.visit(node.expression) as ESTree.Expression;

      const predefinedVariables = findIdentifiersToDefine(node);
      const declarations: ESTree.VariableDeclaration | null =
        predefinedVariables.length > 0
          ? {
              type: "VariableDeclaration",
              kind: "let",
              declarations: predefinedVariables.map((v) => ({
                type: "VariableDeclarator",
                id: ESTreeBuilder.identifier(node, v),
                init: null,
              })),
            }
          : null;

      let result: ESTree.Expression = ESTreeBuilder.identifier(
        node,
        "undefined"
      );

      for (let i = node.cases.length - 1; i >= 0; i--) {
        const c = node.cases[i];
        const condition = this.generateCondition(c.pattern, matchVar);
        const body = this.visit(c.body) as ESTree.Expression;

        result = {
          type: "ConditionalExpression",
          test: condition,
          consequent: body,
          alternate: result,
        };
      }

      const funcBody: ESTree.Statement[] = [];
      if (declarations) funcBody.push(declarations);
      funcBody.push(ESTreeBuilder.returnStatement(node, result));

      return ESTreeBuilder.callExpression(
        node,
        {
          type: "ArrowFunctionExpression",
          params: [matchVarId],
          body: ESTreeBuilder.blockStatement(node, funcBody),
          expression: false,
          generator: false,
          async: false,
        } as ESTree.ArrowFunctionExpression,
        [matchVal]
      );
    });
  }

  private generateCondition(
    pattern: ast.PatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);

    switch (pattern._type) {
      case "any-pattern":
        return ESTreeBuilder.literal(pattern, true);

      case "identifier-pattern":
        if (pattern.id.id in this.enumKeys) {
          return {
            type: "BinaryExpression",
            operator: "===",
            left: matchVarId,
            right: ESTreeBuilder.literal(pattern, this.enumKeys[pattern.id.id]),
          } as ESTree.BinaryExpression;
        }
        return ESTreeBuilder.sequenceExpression(pattern, [
          {
            type: "AssignmentExpression",
            operator: "=",
            left: this.visit(pattern.id) as ESTree.Identifier,
            right: matchVarId,
          } as ESTree.AssignmentExpression,
          ESTreeBuilder.literal(pattern, true),
        ]);

      case "constant-pattern":
        return {
          type: "BinaryExpression",
          operator: "===",
          left: matchVarId,
          right: this.visit(pattern.constant) as ESTree.Expression,
        } as ESTree.BinaryExpression;

      case "list-pattern":
      case "vector-pattern":
        return this.generateArrayPatternCondition(
          pattern as ast.ListPatternNode,
          matchVar
        );

      case "map-pattern":
        return this.generateMapPatternCondition(
          pattern as ast.MapPatternNode,
          matchVar
        );

      default:
        return ESTreeBuilder.literal(pattern, false);
    }
  }

  private generateArrayPatternCondition(
    pattern: ast.ListPatternNode | ast.VectorPatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);
    const conditions: ESTree.Expression[] = [];

    conditions.push(
      ESTreeBuilder.callExpression(
        pattern,
        ESTreeBuilder.memberExpression(
          pattern,
          ESTreeBuilder.identifier(pattern, "Array"),
          ESTreeBuilder.identifier(pattern, "isArray")
        ),
        [matchVarId]
      )
    );

    conditions.push({
      type: "BinaryExpression",
      operator: "===",
      left: ESTreeBuilder.memberExpression(
        pattern,
        matchVarId,
        ESTreeBuilder.identifier(pattern, "length")
      ),
      right: ESTreeBuilder.literal(pattern, pattern.elements.length),
    } as ESTree.BinaryExpression);

    pattern.elements.forEach((elem, idx) => {
      const elemAccess = ESTreeBuilder.memberExpression(
        elem,
        matchVarId,
        ESTreeBuilder.literal(elem, idx),
        true
      );
      conditions.push(this.generateCondition(elem, `${matchVar}[${idx}]`));
    });

    return conditions.reduce(
      (acc, cond) =>
        ({
          type: "LogicalExpression",
          operator: "&&",
          left: acc,
          right: cond,
        } as ESTree.LogicalExpression)
    );
  }

  private generateMapPatternCondition(
    pattern: ast.MapPatternNode,
    matchVar: string
  ): ESTree.Expression {
    const matchVarId = ESTreeBuilder.identifier(pattern, matchVar);
    const conditions: ESTree.Expression[] = [];

    conditions.push({
      type: "LogicalExpression",
      operator: "&&",
      left: {
        type: "BinaryExpression",
        operator: "===",
        left: {
          type: "UnaryExpression",
          operator: "typeof",
          argument: matchVarId,
          prefix: true,
        },
        right: ESTreeBuilder.literal(pattern, "object"),
      } as ESTree.BinaryExpression,
      right: {
        type: "BinaryExpression",
        operator: "!==",
        left: matchVarId,
        right: ESTreeBuilder.literal(pattern, null),
      } as ESTree.BinaryExpression,
    } as ESTree.LogicalExpression);

    pattern.pairs.forEach((pair) => {
      let keyStr: string;
      if (pair.key._type === "simple-identifier") {
        keyStr = (pair.key as ast.SimpleIdentifierNode).id;
      } else if (pair.key._type === "string") {
        keyStr = (pair.key as ast.StringNode).value;
      } else {
        keyStr = this.visit(pair.key).toString();
      }

      conditions.push(
        this.generateCondition(pair.pattern, `${matchVar}["${keyStr}"]`)
      );
    });

    return conditions.reduce(
      (acc, cond) =>
        ({
          type: "LogicalExpression",
          operator: "&&",
          left: acc,
          right: cond,
        } as ESTree.LogicalExpression)
    );
  }

  // =========================================================================
  // Identifiers / Literals
  // =========================================================================

  visitIdentifier(node: ast.IdentifierNode): ESTree.Identifier {
    if (this.identifiersCache[node.id]) {
      return ESTreeBuilder.identifier(node, this.identifiersCache[node.id]);
    }

    try {
      const resolved = this.context?.symbolTable?.resolveSymbol?.(node as any);
      if (
        resolved?.value?._location &&
        this.rootSource &&
        resolved.value._location.source !== this.rootSource
      ) {
        const uniq = this.ensureSymbolInlined(resolved);
        this.identifiersCache[node.id] = uniq;
        return ESTreeBuilder.identifier(node, uniq);
      }
    } catch (e) {
      // Fall through
    }

    const id = encodeIdentifier(node.id);
    this.identifiersCache[node.id] = id;

    if (RuntimeProvider.isRuntimeReference(node.id)) {
      if (node._type === "composite-identifier") {
        let aggregate = node.parts[0];
        for (let i = 1; i < node.parts.length; ++i) {
          this.inlineStandardSymbols.push(aggregate);
          aggregate = `${aggregate}.${node.parts[i]}`;
        }
        this.inlineStandardSymbols.push(aggregate);
      } else {
        this.inlineStandardSymbols.push(node.id);
      }
    }

    return ESTreeBuilder.identifier(node, id);
  }

  visitSimpleIdentifier(node: ast.SimpleIdentifierNode): ESTree.Identifier {
    return this.visitIdentifier(node);
  }

  visitCompositeIdentifier(
    node: ast.CompositeIdentifierNode
  ): ESTree.MemberExpression {
    const parts = node.parts;
    let expr: ESTree.Expression = ESTreeBuilder.identifier(
      node,
      encodeIdentifier(parts[0])
    );

    for (let i = 1; i < parts.length; i++) {
      expr = ESTreeBuilder.memberExpression(
        node,
        expr,
        ESTreeBuilder.identifier(node, parts[i])
      );
    }

    return expr as ESTree.MemberExpression;
  }

  visitString(node: ast.StringNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitBoolean(node: ast.BooleanNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitIntegerNumber(node: ast.IntegerNumberNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitFloatNumber(node: ast.FloatNumberNode): ESTree.Literal {
    return ESTreeBuilder.literal(node, node.value);
  }

  visitFormattedString(node: ast.FormattedStringNode): ESTree.TemplateLiteral {
    const quasis: ESTree.TemplateElement[] = [];
    const expressions: ESTree.Expression[] = [];

    let currentString = "";

    for (let i = 0; i < node.value.length; i++) {
      const v = node.value[i];
      if (v._type === "string") {
        currentString += v.value;
      } else {
        quasis.push({
          type: "TemplateElement",
          value: { raw: currentString, cooked: currentString },
          tail: false,
        });
        currentString = "";

        const expr = this.visit(v) as ESTree.Expression;
        expressions.push(
          ESTreeBuilder.callExpression(
            v,
            ESTreeBuilder.identifier(v, "__ll_format_object"),
            [expr]
          )
        );
      }
    }

    quasis.push({
      type: "TemplateElement",
      value: { raw: currentString, cooked: currentString },
      tail: true,
    });

    return {
      type: "TemplateLiteral",
      quasis,
      expressions,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitFormatExpression(node: ast.FormatExpressionNode): ESTree.Expression {
    return this.visit(node.expression) as ESTree.Expression;
  }

  // =========================================================================
  // Lists
  // =========================================================================

  visitList(node: ast.ListNode): ESTree.Expression | ESTree.Statement {
    const nodes = Array.isArray(node.nodes) ? node.nodes : [node.nodes];
    if (nodes.length === 0) return ESTreeBuilder.literal(node, null);

    const hasPipelineOp = nodes.some(
      (n) =>
        n._type === "simple-identifier" && ["|>", "<|"].includes((n as any).id)
    );

    if (hasPipelineOp) {
      const result = this.transformPipelineList(nodes);
      if (result) return result;
    }

    const [head, ...rest] = nodes;
    const isHeadIdentifier =
      head._type === "simple-identifier" ||
      head._type === "composite-identifier";

    if (isHeadIdentifier) {
      const headId = (head as any).id;

      if (
        head._type === "simple-identifier" &&
        headId === "new" &&
        rest.length > 0
      ) {
        const className = this.visit(rest[0]) as ESTree.Expression;
        const args = rest
          .slice(1)
          .map((x) => this.visit(x) as ESTree.Expression);
        return {
          type: "NewExpression",
          callee: className,
          arguments: args,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      if (head._type === "simple-identifier" && headId === "return") {
        if (rest.length === 0) {
          return ESTreeBuilder.returnStatement(node, null);
        }
        const returnValue = this.runInScope(
          ScopeType.variable,
          () => this.visit(rest[0]) as ESTree.Expression
        );
        return ESTreeBuilder.returnStatement(node, returnValue);
      }

      const callee = this.visit(head) as ESTree.Expression;
      const args = rest.map((x) => this.visit(x) as ESTree.Expression);
      const calleeStr = this.expressionToString(callee);

      if (this.classes.includes(calleeStr)) {
        return {
          type: "NewExpression",
          callee,
          arguments: args,
          loc: ESTreeBuilder.loc(node),
        } as ESTree.NewExpression;
      }

      let memberName = calleeStr;
      if (head._type === "composite-identifier") {
        const parts = calleeStr.split(".");
        memberName = parts[parts.length - 1];
      }

      const isKnownFunction =
        this.functions.includes(calleeStr) ||
        this.functions.includes(memberName);

      if (args.length > 0 || isKnownFunction) {
        return ESTreeBuilder.callExpression(node, callee, args);
      }

      return callee;
    }

    // Implicit block
    const statements = nodes.map((x) => {
      const result = this.visit(x);
      return this.isStatement(result)
        ? (result as ESTree.Statement)
        : ESTreeBuilder.expressionStatement(x, result as ESTree.Expression);
    });

    if (statements.length === 1) return statements[0];

    return ESTreeBuilder.blockStatement(node, statements);
  }

  // =========================================================================
  // Misc
  // =========================================================================

  visitVector(node: ast.VectorNode): ESTree.ArrayExpression {
    return {
      type: "ArrayExpression",
      elements: node.values.map((x) => this.visit(x) as ESTree.Expression),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitMatrix(node: ast.MatrixNode): ESTree.ArrayExpression {
    return {
      type: "ArrayExpression",
      elements: node.rows.map(
        (row) =>
          ({
            type: "ArrayExpression",
            elements: row.map((x) => this.visit(x) as ESTree.Expression),
          } as ESTree.ArrayExpression)
      ),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitMap(node: ast.MapNode): ESTree.ObjectExpression {
    return {
      type: "ObjectExpression",
      properties: node.values.map((x) => this.visit(x) as ESTree.Property),
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitKeyValue(node: ast.KeyValueNode): ESTree.Property {
    const key =
      node.key._type === "simple-identifier"
        ? ESTreeBuilder.identifier(
            node.key,
            (node.key as ast.SimpleIdentifierNode).id
          )
        : (this.visit(node.key) as ESTree.Expression);

    const value = this.visit(node.value) as ESTree.Expression;

    return {
      type: "Property",
      key,
      value,
      kind: "init",
      method: false,
      shorthand: false,
      computed: false,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitSimpleAssignment(
    node: ast.SimpleAssignmentNode
  ): ESTree.AssignmentExpression {
    return {
      type: "AssignmentExpression",
      operator: "=",
      left: this.visit(node.assignable) as ESTree.Pattern,
      right: this.visit(node.value) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitCompoundAssignment(
    node: ast.CompoundAssignmentNode
  ): ESTree.AssignmentExpression {
    return {
      type: "AssignmentExpression",
      operator: node.operator.replace(":", "") as any,
      left: this.visit(node.assignable) as ESTree.Pattern,
      right: this.visit(node.value) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitIndexer(node: ast.IndexerNode): ESTree.MemberExpression {
    let expr = this.visit(node.id) as ESTree.Expression;

    for (const indices of node.indices) {
      for (const idx of indices) {
        expr = ESTreeBuilder.memberExpression(
          node,
          expr,
          this.visit(idx) as ESTree.Expression,
          true
        );
      }
    }

    return expr as ESTree.MemberExpression;
  }

  visitAwait(node: ast.AwaitNode): ESTree.AwaitExpression {
    return {
      type: "AwaitExpression",
      argument: this.visit(node.expression) as ESTree.Expression,
      loc: ESTreeBuilder.loc(node),
    };
  }

  visitControlComment(node: ast.ControlCommentNode): ESTree.EmptyStatement {
    return { type: "EmptyStatement" };
  }

  visitComment(node: ast.CommentNode): ESTree.EmptyStatement {
    return { type: "EmptyStatement" };
  }

  visitQuote(node: ast.QuoteNode): ESTree.Literal {
    if (node.mode !== "default") return ESTreeBuilder.literal(node, null);
    const serialized = JSON.stringify(node, (key, val) =>
      ["_location", "_parent"].includes(key) ? undefined : val
    );
    return ESTreeBuilder.literal(node, serialized);
  }

  visitNull(node: ast.NullNode) {
    return ESTreeBuilder.literal(node, null);
  }

  // =========================================================================
  // Utilities
  // =========================================================================

  private isStatement(node: any): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type &&
      (type.endsWith("Statement") ||
        type.endsWith("Declaration") ||
        type === "MethodDefinition")
    );
  }

  private isExpression(node: any): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type &&
      (type.endsWith("Expression") ||
        type === "Identifier" ||
        type === "Literal" ||
        type === "TemplateLiteral")
    );
  }

  private isReturnStatement(node: any): boolean {
    return node && typeof node === "object" && node.type === "ReturnStatement";
  }

  private isControlStatement(node: any): boolean {
    if (!node || typeof node !== "object") return false;
    const type = node.type;
    return (
      type === "IfStatement" ||
      type === "WhileStatement" ||
      type === "ForStatement" ||
      type === "ForOfStatement" ||
      type === "TryStatement"
    );
  }

  private expressionToString(expr: ESTree.Expression): string {
    if (expr.type === "Identifier") {
      return (expr as ESTree.Identifier).name;
    }
    if (expr.type === "MemberExpression") {
      const mem = expr as ESTree.MemberExpression;
      const obj = this.expressionToString(mem.object as ESTree.Expression);
      const prop = mem.computed
        ? `[${this.expressionToString(mem.property as ESTree.Expression)}]`
        : `.${(mem.property as ESTree.Identifier).name}`;
      return obj + prop;
    }
    return generate(expr);
  }

  private cloneNode<T extends ast.ASTNode>(n: T): T {
    const cache = new Set<any>();
    return JSON.parse(
      JSON.stringify(n, (key, value) => {
        if (typeof value === "object" && value !== null) {
          if (cache.has(value)) return;
          cache.add(value);
        }
        return value;
      })
    ) as T;
  }

  private ensureSymbolInlined(symbol: SymbolEntry): string {
    const src =
      (symbol.value &&
        (symbol.value as any)._location &&
        (symbol.value as any)._location.source) ||
      "";
    const symName =
      (symbol.name as any).id ??
      (symbol.name as any).name ??
      String(Math.random());
    const key = `${src}::${symName}`;

    if (this.inlinedSymbols[key]) return this.inlinedSymbols[key];

    try {
      const uniq = uniqueIdentifier("inlined_" + encodeIdentifier(symName));
      this.inlinedSymbols[key] = uniq;

      let defStmt: ESTree.Statement;

      if (symbol.type === "function") {
        const fn = this.cloneNode(
          symbol.value as ast.FunctionNode
        ) as ast.FunctionNode;
        fn.name = fn.name
          ? ({ ...fn.name, id: uniq } as any)
          : ({ _type: "simple-identifier", id: uniq } as any);
        defStmt = this.visit(fn) as ESTree.Statement;
      } else if (symbol.type === "class") {
        const cls = this.cloneNode(
          symbol.value as ast.ClassNode
        ) as ast.ClassNode;
        cls.name = cls.name
          ? ({ ...cls.name, name: uniq } as any)
          : ({ _type: "identifier", name: uniq } as any);
        defStmt = this.visit(cls) as ESTree.Statement;
      } else if (symbol.type === "variable") {
        const v = this.cloneNode(
          symbol.value as ast.VariableNode
        ) as ast.VariableNode;
        const valueExpr = v.value
          ? (this.visit(v.value) as ESTree.Expression)
          : ESTreeBuilder.identifier(v, "undefined");
        defStmt = {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ESTreeBuilder.identifier(v, uniq),
              init: valueExpr,
            },
          ],
        };
      } else {
        const val = (symbol.value as any)
          ? (this.visit(symbol.value as any) as ESTree.Expression)
          : ESTreeBuilder.identifier(symbol.value as any, "undefined");
        defStmt = {
          type: "VariableDeclaration",
          kind: "const",
          declarations: [
            {
              type: "VariableDeclarator",
              id: ESTreeBuilder.identifier(symbol.value as any, uniq),
              init: val,
            },
          ],
        };
      }

      this.inlinedDefinitions[uniq] = defStmt;
      return uniq;
    } catch (ex) {
      console.error("ensureSymbolInlined error for", symName, ex);
      return encodeIdentifier(symName);
    }
  }
}

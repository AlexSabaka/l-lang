import * as recast from "recast";
import * as ast from "../ast";
import { namedTypes as n, builders as b } from "ast-types";
import * as K from "ast-types/lib/gen/kinds";

import { BaseAstVisitor } from "./BaseAstVisitor";
import { LogLevel } from "../Context";
import { ScopeType } from "../SymbolTable";

export class RecastAstVisitor extends BaseAstVisitor {
  scope: ScopeType[] = [ScopeType.program];
  functions: string[] = [];
  classes: string[] = [];
  variables: string[] = [];
  identifiers: Record<string, string> = {};
  uniqueIdCounter = 0;

  compile(root: ast.ASTNode): string {
    const jsAST = this.visit(root, (node) => b.noop());

    const metadataString =
      `// Module: ${this.context.mainModule}\n` +
      `// File: ${this.context.dependencyGraph.rootUnit.location.fullName}\n` +
      `// Compiled at: ${new Date().toISOString()}\n` +
      `"use strict";\n\n`;

    return (
      metadataString +
      recast.print(jsAST as n.Node, { tabWidth: 2 }).code
    );
  }

  pushScope(nextScope: ScopeType) {
    this.scope.unshift(nextScope);
  }

  popScope() {
    return this.scope.shift();
  }

  currentScope(): ScopeType {
    return this.scope[0];
  }

  inScope(...scopes: ScopeType[]): boolean {
    return scopes.includes(this.currentScope());
  }

  generateUniqueIdentifier(base: string): string {
    return `${base}_${this.uniqueIdCounter++}`;
  }

  visitProgram(node: ast.ProgramNode): n.Program {
    const body = node.program
      .map((n) => this.visit(n))
      .filter((x): x is K.StatementKind => x !== null && n.Statement.check(x));
    return b.program(body);
  }

  visitVariable(node: ast.VariableNode): n.VariableDeclaration {
    const id = b.identifier(node.name.id);
    const init = node.value
      ? (this.visit(node.value) as K.ExpressionKind)
      : null;
    const kind = node.mutable ? "let" : "const";
    const declarator = b.variableDeclarator(id, init);
    return b.variableDeclaration(kind, [declarator]);
  }

  visitFunction(
    node: ast.FunctionNode
  ): n.FunctionDeclaration | n.VariableDeclaration | n.FunctionExpression {
    const id = node.name
      ? (this.visit(node.name) as n.Identifier)
      : null;
    const params = node.params.map(
      (param) => this.visit(param) as K.PatternKind
    );
    const bodyStatements = node.body.map((x) => this.visit(x));
    const body = b.blockStatement(bodyStatements);
    const isAsync = node.async;

    if (id && this.currentScope() === ScopeType.program) {
      const funcDecl = b.functionDeclaration(
        id,
        params,
        body,
        false,
        isAsync
      );
      this.functions.push(id.name);
      return funcDecl;
    } else {
      const funcExpr = b.functionExpression(
        id,
        params,
        body,
        false,
        isAsync
      );
      if (id) {
        const varDecl = b.variableDeclaration("const", [
          b.variableDeclarator(id, funcExpr),
        ]);
        this.functions.push(id.name);
        return varDecl;
      } else {
        return funcExpr;
      }
    }
  }

  visitFunctionParameter(
    node: ast.ParameterNode
  ): K.PatternKind {
    return this.visit(node.name) as K.PatternKind;
  }

  visitIdentifier(node: ast.IdentifierNode): n.Identifier | n.MemberExpression | K.ExpressionKind {
    if (node._type === "simple-identifier") {
      return b.identifier(node.id);
    } else {
      const [ first, ...rest ] = node.parts.map((part) => b.identifier(part));
      return rest.reduce(
        (acc, curr) => b.memberExpression(acc, curr, false), first as K.ExpressionKind);
    }
  }

  visitNumber(node: ast.NumberNode): K.ExpressionKind {
    switch (node._type) {
      case "fraction-number":
        return b.binaryExpression('/', b.literal(node.numerator), b.literal(node.denominator));
      default:
        return b.literal(node.value.toString());
    }
  }

  visitString(node: ast.StringNode): K.ExpressionKind {
    return b.literal(node.value);
  }

  visitList(node: ast.ListNode): n.BlockStatement {
    // return b.program([
    //   b.blockStatement([
    //     b.expressionStatement(
    //       b.callExpression(
    //         b.identifier("std.console.log"),
    //         [b.literal("Hello, world!")]
    //       )
    //     )
    //   ])
    // ]);
    return b.blockStatement(
      node.nodes.map((x) => this.visit(x))
    );
  }

  visitVector(node: ast.VectorNode): n.ArrayExpression {
    const elements = node.values
      .map((value) => this.visit(value))
      .filter((elem): elem is K.ExpressionKind | K.SpreadElementKind | null => elem === null || n.Expression.check(elem));
    return b.arrayExpression(elements);
  }

  visitMap(node: ast.MapNode): n.ObjectExpression {
    const properties = node.values
      .map((kv) => this.visit(kv))
      .filter((prop): prop is K.PropertyKind => prop !== null && n.Property.check(prop));
    return b.objectExpression(properties);
  }

  visitKeyValue(node: ast.KeyValueNode): n.Property | null {
    const keyNode = this.visit(node.key);
    const valueNode = this.visit(node.value) as K.ExpressionKind;

    let key: K.ExpressionKind | K.PrivateNameKind | K.IdentifierKind | K.LiteralKind | null = null;
    if (n.Identifier.check(keyNode) || n.Literal.check(keyNode)) {
      key = keyNode;
    } else if (n.Expression.check(keyNode)) {
      key = keyNode as K.ExpressionKind;
    } else {
      this.context.log(
        LogLevel.Error,
        `Invalid key in key-value pair: ${JSON.stringify(keyNode)}`
      );
      return null;
    }

    return b.property("init", key as K.ExpressionKind, valueNode);
  }

  visitMatch(node: ast.MatchNode): n.CallExpression {
    const matchVarName = this.generateUniqueIdentifier("matchVar");
    const matchVar = b.identifier(matchVarName);
    const matchVal = this.visit(node.expression) as K.ExpressionKind;

    const cases = node.cases.map((matchCase) => {
      const condition = this.generateCondition(matchCase.pattern, matchVar);
      const bodyExpr = this.visit(matchCase.body) as K.ExpressionKind;
      return { condition, body: bodyExpr };
    });

    let defaultCase: K.ExpressionKind = b.literal(null);
    let expr: K.ExpressionKind = defaultCase;

    for (let i = cases.length - 1; i >= 0; i--) {
      const { condition, body } = cases[i];
      expr = b.conditionalExpression(condition as K.ExpressionKind, body as K.ExpressionKind, expr as K.ExpressionKind);
    }

    const funcExpr = b.arrowFunctionExpression([matchVar], expr as K.ExpressionKind);
    return b.callExpression(funcExpr, [matchVal]);
  }

  generateCondition(
    pattern: ast.PatternNode,
    value: n.Identifier
  ): n.Expression {
    switch (pattern._type) {
      case "any-pattern":
        return b.literal(true);
      case "identifier-pattern":
        const id = this.visit(pattern.id) as n.Identifier;
        const assignExpr = b.assignmentExpression("=", id, value);
        return b.sequenceExpression([assignExpr, b.literal(true)]);
      case "constant-pattern":
        const constantValue = this.visit(pattern.constant) as K.ExpressionKind;
        return b.binaryExpression("===", value, constantValue);
      case "list-pattern":
        return this.generateListPatternCondition(
          pattern as ast.ListPatternNode,
          value
        );
      case "vector-pattern":
        return this.generateListPatternCondition(
          pattern as ast.VectorPatternNode,
          value
        );
      case "map-pattern":
        return this.generateMapPatternCondition(
          pattern as ast.MapPatternNode,
          value
        );
      default:
        return b.literal(false);
    }
  }

  generateListPatternCondition(
    pattern: ast.ListPatternNode | ast.VectorPatternNode,
    value: n.Identifier
  ): n.Expression {
    const conditions: n.Expression[] = [
      b.callExpression(
        b.memberExpression(b.identifier("Array"), b.identifier("isArray"), false),
        [value]
      ),
      b.binaryExpression(
        "===",
        b.memberExpression(value, b.identifier("length"), false),
        b.literal(pattern.elements.length)
      ),
    ];

    pattern.elements.forEach((elem, idx) => {
      const elemValue = b.memberExpression(value, b.literal(idx), true);
      const elemCondition = this.generateElementCondition(elem, elemValue);
      if (elemCondition) {
        conditions.push(elemCondition);
      }
    });

    return conditions.reduce((prev, curr) => b.logicalExpression("&&", prev as K.ExpressionKind, curr as K.ExpressionKind));
  }

  generateMapPatternCondition(
    pattern: ast.MapPatternNode,
    value: n.Identifier
  ): n.Expression {
    const conditions: n.Expression[] = [
      b.logicalExpression(
        "&&",
        b.binaryExpression("===", b.unaryExpression("typeof", value, true), b.literal("object")),
        b.binaryExpression("!==", value, b.literal(null))
      ),
    ];

    pattern.pairs.forEach((pair) => {
      const keyNode = this.visit(pair.key);
      let key: K.ExpressionKind | K.PrivateNameKind | K.IdentifierKind | K.LiteralKind;
      if (n.Identifier.check(keyNode) || n.Literal.check(keyNode)) {
        key = keyNode;
      } else if (n.Expression.check(keyNode)) {
        key = keyNode as K.ExpressionKind;
      } else {
        this.context.log(
          LogLevel.Error,
          `Invalid key in map pattern pair: ${JSON.stringify(keyNode)}`
        );
        return;
      }
      const elemValue = b.memberExpression(value, key, !n.Identifier.check(key));
      conditions.push(
        b.binaryExpression(
          "in",
          key,
          value
        )
      );
      const elemCondition = this.generateElementCondition(pair.pattern, elemValue);
      if (elemCondition) {
        conditions.push(elemCondition);
      }
    });

    return conditions.reduce((prev, curr) => b.logicalExpression("&&", prev as K.ExpressionKind, curr as K.ExpressionKind));
  }

  generateElementCondition(
    pattern: ast.PatternNode,
    value: n.Expression
  ): n.Expression | null {
    switch (pattern._type) {
      case "any-pattern":
        return null;
      case "identifier-pattern":
        const id = this.visit(pattern.id) as n.Identifier;
        const assignExpr = b.assignmentExpression("=", id, value as K.ExpressionKind);
        return b.sequenceExpression([assignExpr, b.literal(true)]);
      case "constant-pattern":
        const constantValue = this.visit(pattern.constant) as K.ExpressionKind;
        return b.binaryExpression("===", value as K.ExpressionKind, constantValue);
      case "list-pattern":
      case "vector-pattern":
      case "map-pattern":
        const tempVarName = this.generateUniqueIdentifier("temp");
        const tempVar = b.identifier(tempVarName);
        const assignTempVar = b.assignmentExpression("=", tempVar, value as K.ExpressionKind);
        const patternCondition =
          pattern._type === "map-pattern"
            ? this.generateMapPatternCondition(pattern as ast.MapPatternNode, tempVar)
            : this.generateListPatternCondition(pattern as any, tempVar);
        return b.sequenceExpression([assignTempVar, patternCondition as K.ExpressionKind]);
      default:
        return b.literal(false);
    }
  }

  visitIdentifierPattern(
    node: ast.IdentifierPatternNode
  ): n.Identifier {
    return this.visit(node.id) as n.Identifier;
  }

  visitConstantPattern(
    node: ast.ConstantPatternNode
  ): n.Literal {
    return this.visit(node.constant) as n.Literal;
  }

  visitAnyPattern(node: ast.AnyPatternNode): n.Literal {
    return b.literal(true);
  }

  visitFunctionCarrying(
    node: ast.FunctionCarryingNode
  ): n.Expression {
    let code: n.Expression = this.visit(node.identifier) as n.Expression;
    // node.sequence.forEach((seqItem) => {
    //   const func = this.visit(seqItem.function) as K.ExpressionKind;
    //   const args = seqItem.arguments
    //     .map((arg) => this.visit(arg))
    //     .filter((arg): arg is K.ExpressionKind | K.SpreadElementKind => arg !== null && n.Expression.check(arg));
    //   if (seqItem._type === "function-carrying-left") {
    //     code = b.callExpression(func, [code as K.ExpressionKind, ...args]);
    //   } else if (seqItem._type === "function-carrying-right") {
    //     code = b.callExpression(func, [...args, code as K.ExpressionKind]);
    //   }
    // });
    return code;
  }

  visitIf(node: ast.IfNode): n.IfStatement {
    const test = this.visit(node.condition!) as K.ExpressionKind;
    const consequentStatements = [this.visit(node.then!)]
      .filter((stmt): stmt is K.StatementKind => stmt !== null && n.Statement.check(stmt));
    const consequent = b.blockStatement(consequentStatements);
    const alternateStatements = node.else
      ? [this.visit(node.else)].filter((stmt): stmt is K.StatementKind => stmt !== null && n.Statement.check(stmt))
      : null;
    const alternate = alternateStatements
      ? b.blockStatement(alternateStatements)
      : null;
    return b.ifStatement(test, consequent, alternate);
  }

  // Add more visitor methods as needed
}

import * as t from "@babel/types";
import { BaseAstVisitor } from "./BaseAstVisitor";
import * as ast from "../ast";
import { Context, LogLevel } from "../Context";

export class ConvertAstToJsVisitor extends BaseAstVisitor {
  constructor(context: Context) {
    super(context);
  }

  visitProgram(node: ast.ProgramNode): t.Program {
    const body = node.program.map(stmt => this.visit(stmt) as t.Statement);
    return t.program(body);
  }

  visitVariable(node: ast.VariableNode): t.VariableDeclaration {
    const id = this.visit(node.name) as t.Identifier;
    const init = node.value ? this.visit(node.value) as t.Expression : null;
    const kind = node.mutable ? "let" : "const";
    return t.variableDeclaration(kind, [t.variableDeclarator(id, init)]);
  }

  visitFunction(node: ast.FunctionNode): t.FunctionDeclaration {
    const id = node.name ? this.visit(node.name) as t.Identifier : null;
    const params = node.params.map(param => this.visit(param) as t.Identifier);
    const body = t.blockStatement(node.body.map(stmt => this.visit(stmt) as t.Statement));
    return t.functionDeclaration(id, params, body);
  }

  visitIdentifier(node: ast.IdentifierNode): t.Identifier {
    return t.identifier(node.id);
  }

  visitString(node: ast.StringNode): t.StringLiteral {
    return t.stringLiteral(node.value);
  }

  visitNumber(node: ast.NumberNode): t.NumericLiteral {
    return t.numericLiteral(node.value);
  }

  visitList(node: ast.ListNode): t.ArrayExpression {
    return t.arrayExpression(node.nodes.map(item => this.visit(item) as t.Expression));
  }

  visitIf(node: ast.IfNode): t.IfStatement {
    const test = this.visit(node.condition!) as t.Expression;
    const consequent = this.visit(node.then!) as t.Statement;
    const alternate = node.else ? this.visit(node.else) as t.Statement : null;
    return t.ifStatement(test, consequent, alternate);
  }

  visitWhile(node: ast.WhileNode): t.WhileStatement {
    const test = this.visit(node.condition) as t.Expression;
    const body = this.visit(node.then) as t.Statement;
    return t.whileStatement(test, body);
  }

  visitAssignment(node: ast.SimpleAssignmentNode): t.AssignmentExpression {
    const left = this.visit(node.assignable) as t.LVal;
    const right = this.visit(node.value) as t.Expression;
    return t.assignmentExpression("=", left, right);
  }

  // Add more visit methods for other node types as needed

  visit(node: ast.ASTNode): t.Node {
    const method = `visit${node._type.charAt(0).toUpperCase() + node._type.slice(1)}`;
    if (typeof (this as any)[method] === "function") {
      return (this as any)[method](node);
    }
    this.context.log(LogLevel.Error, `Unhandled node type: ${node._type}`);
    return t.nullLiteral(); // Default fallback
  }
}

import * as ast from "../ast";
import { ScopeType, SymbolTable } from "../SymbolTable";
import { BaseAstVisitor } from "./BaseAstVisitor";

export class BuildSymbolTableAstVisitor extends BaseAstVisitor {
  private symbols: SymbolTable = new SymbolTable();

  visitProgram(node: ast.ProgramNode) {
    this.symbols.enterScope(ScopeType.program);
    node.program.map(x => this.visit(x));
    this.symbols.exitScope();
  }

  visitImport(node: ast.ImportNode) {
    // pass
  }

  visitTypeName(node: ast.TypeNameNode) {
    // pass
  }

  visitUnionType(node: ast.UnionTypeNode) {
    // pass
  }

  visitIntersectionType(node: ast.IntersectionTypeNode) {
    // pass
  }

  visitSimpleType(node: ast.SimpleTypeNode) {
    // pass
  }

  visitGenericType(node: ast.GenericTypeNode) {
    // pass
  }

  visitMapType(node: ast.MapTypeNode) {
    // pass
  }

  visitMappedType(node: ast.MappedTypeNode) {
    // pass
  }

  visitTypeMapping(node: ast.TypeMappingNode) {
    // pass
  }

  visitFieldModifier(node: ast.FieldModifierNode) {
    // pass
  }

  visitParameterModifier(node: ast.ParameterModifierNode) {
    // pass
  }

  visitFunctionCarrying(node: ast.FunctionCarryingNode) {
    // pass
  }

  visitFunctionCarryingLeft(node: ast.FunctionCarryingLeftNode) {
    // pass
  }

  visitFunctionCarryingRight(node: ast.FunctionCarryingRightNode) {
    // pass
  }

  visitClass(node: ast.ClassNode) {
    // pass
  }

  visitInterface(node: ast.InterfaceNode) {
    // pass
  }

  visitAccessModifier(node: ast.AccessModifierNode) {
    // pass
  }

  visitImplements(node: ast.ImplementsNode) {
    // pass
  }

  visitExtends(node: ast.ExtendsNode) {
    // pass
  }

  visitConstraintImplements(node: ast.ConstraintImplementsNode) {
    // pass
  }

  visitConstraintInherits(node: ast.ConstraintInheritsNode) {
    // pass
  }

  visitConstraintIs(node: ast.ConstraintIsNode) {
    // pass
  }

  visitConstraintHas(node: ast.ConstraintHasNode) {
    // pass
  }

  visitMatchCase(node: ast.MatchCaseNode) {
    // pass
  }

  visitListPattern(node: ast.ListPatternNode) {
    // pass
  }

  visitVectorPattern(node: ast.VectorPatternNode) {
    // pass
  }

  visitMapPattern(node: ast.MapPatternNode) {
    // pass
  }

  visitMapPatternPair(node: ast.MapPatternPairNode) {
    // pass
  }

  visitControlComment(node: ast.ControlCommentNode) {
    // pass
  }

  // Existing methods
  visitString(node: ast.StringNode) {
    // pass
  }

  visitFormattedString(node: ast.FormattedStringNode) {
    // pass
  }

  visitFormatExpression(node: ast.FormatExpressionNode) {
    // pass
  }

  visitIdentifier(node: ast.IdentifierNode) {
    // pass
  }

  visitVariable(node: ast.VariableNode) {
    // pass
  }

  visitFunction(node: ast.FunctionNode) {
    this.symbols.enterScope(ScopeType.function);
    node.params.map(x => this.symbols.defineSymbol(x as any));
    node.body.map(x => this.visit(x));
    this.symbols.exitScope();
    this.symbols.defineSymbol(node);
  }

  visitFunctionParameter(node: ast.FunctionParameterNode) {
    // pass
  }

  visitAwait(node: ast.AwaitNode) {
    // pass
  }

  visitWhen(node: ast.WhenNode) {
    this.symbols.enterScope(ScopeType.when);
    node.then.map(x => this.visit(x));
    this.symbols.exitScope();
  }

  visitIf(node: ast.IfNode) {
    this.symbols.enterScope(ScopeType.if);
    this.visit(node.then);
    node.else && this.visit(node.else);
    this.symbols.exitScope();
  }

  visitMatch(node: ast.MatchNode) {
    this.symbols.enterScope(ScopeType.match);
    node.cases.map(x => this.visit(x));
    this.symbols.exitScope();
  }

  visitAnyPattern(node: ast.AnyPatternNode) {
    // pass
  }

  visitIdentifierPattern(node: ast.IdentifierPatternNode) {
    // pass
  }

  visitConstantPattern(node: ast.ConstantPatternNode) {
    // pass
  }

  visitNumber(node: ast.NumberNode) {
    // pass
  }

  visitList(node: ast.ListNode) {
    // pass
  }

  visitQuote(node: ast.QuoteNode) {
    // pass
  }

  visitVector(node: ast.VectorNode) {
    // pass
  }

  visitMap(node: ast.MapNode) {
    // pass
  }

  visitKeyValue(node: ast.MapKeyValueNode) {
    // pass
  }

  visitComment(node: ast.CommentNode) {
    // pass
  }
};

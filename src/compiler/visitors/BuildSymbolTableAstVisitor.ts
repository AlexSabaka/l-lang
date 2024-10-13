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

  visitFunction(node: ast.FunctionNode) {
    this.symbols.enterScope(ScopeType.function);
    node.params.map(x => this.symbols.defineSymbol(x as any));
    node.body.map(x => this.visit(x));
    this.symbols.exitScope();
    this.symbols.defineSymbol(node);
  }

  visitWhen(node: ast.WhenNode) {
    this.symbols.enterScope(ScopeType.when);
    node.then?.map(x => this.visit(x));
    this.symbols.exitScope();
  }

  visitIf(node: ast.IfNode) {
    this.symbols.enterScope(ScopeType.if);
    this.visit(node.then!);
    node.else && this.visit(node.else!);
    this.symbols.exitScope();
  }

  visitMatch(node: ast.MatchNode) {
    this.symbols.enterScope(ScopeType.match);
    node.cases.map(x => this.visit(x));
    this.symbols.exitScope();
  }
};

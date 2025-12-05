import * as ast from "../ast";
import { LogLevel } from "../Context";
import { ScopeType, SymbolTable, SymbolTableBuilder } from "../SymbolTable";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";

export class BuildSymbolTableAstVisitor extends BaseAstTreeWalker {
  private symbolTableBuilder: SymbolTableBuilder = new SymbolTableBuilder();

  buildSymbolTable(): SymbolTable {
    return this.symbolTableBuilder.build();
  }

  visitProgram(node: ast.ProgramNode) {
    this.symbolTableBuilder.enterScope(node);
    node.program.map(x => super.visit(x));
    // this.symbolTableBuilder.exitScope();
  }

  visitVariable(node: ast.VariableNode) {
    this.symbolTableBuilder.defineSymbol(node);
    [ ...node.modifiers, node.name, node.type, node.value ].map(x => this.visitIfNotNull(x));
  }

  visitFunction(node: ast.FunctionNode) {
    this.symbolTableBuilder.defineSymbol(node);
    [ ...node.modifiers, node.name, ...node.params, node.returns, ...node.body ].map(x => this.visitIfNotNull(x));
  }

  visitClass(node: ast.ClassNode) {
    this.symbolTableBuilder.defineSymbol(node);
    [ ...node.modifiers, node.name, ...node.body ].map(x => this.visitIfNotNull(x));
  }

  visitInterface(node: ast.InterfaceNode) {
    this.symbolTableBuilder.defineSymbol(node);
    [ ...node.modifiers, node.name, ...node.body ].map(x => this.visitIfNotNull(x));
  }

  visitExport(node: ast.ExportNode) {
    node.exports.forEach(x => {
      const symbol = this.symbolTableBuilder.resolveSymbol(x.symbol);
      if (symbol === undefined) {
        this.context.log(LogLevel.Error, "dafadf");
        throw new Error("asfsagda");
      }
      symbol.exportName = x.as ?? x.symbol;
    });
  }

  private visitIfNotNull(node: ast.ASTNode | null | undefined): any {
    return node !== undefined && node !== null ? super.visit(node) : undefined;
  }
};

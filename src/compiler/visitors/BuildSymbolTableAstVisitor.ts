import * as ast from "../ast";
import { ScopeType, SymbolTable } from "../SymbolTable";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";

export class BuildSymbolTableAstVisitor extends BaseAstTreeWalker {
  private symbols: SymbolTable = new SymbolTable();

};

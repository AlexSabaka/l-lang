import * as ast from "../ast";
import { BaseAstVisitor } from ".";

export class BaseAstTreeWalker extends BaseAstVisitor {
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    super.visit(node, defaultVisitor);
    for (const key of ast.getNodeIterableKeys(node)) {
      if (ast.isIterableAstNode(node[key])) {
        node[key].forEach((child) => this.visit(child, defaultVisitor));
      } else if (ast.isAstNode(node[key])) {
        this.visit(node[key], defaultVisitor);
      }
    }
  }
}

import * as ast from "../ast";
import { BaseAstTreeWalker } from "./BaseAstTreeWalker";

export class TreeShakeAstVisitor extends BaseAstTreeWalker {
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): ast.ASTNode {
    const newNode = super.visit(node, defaultVisitor);
    if (newNode !== node) {
      return newNode;
    }
    return node;
  }

  visitList(node: ast.ListNode) {
    if (node.nodes.length === 1) {
      return node.nodes[0];
    }
  }
}

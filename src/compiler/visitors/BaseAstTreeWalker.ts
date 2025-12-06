import * as ast from "../ast";
import { BaseAstVisitor } from ".";

export class BaseAstTreeWalker extends BaseAstVisitor {
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    // 1. Visit the node itself
    const result = super.visit(node, defaultVisitor);

    // 2. STOP if the visitor returned a new node (replacement) 
    // or if the node is null/undefined
    if (!node) return;

    // 3. Robust Generic Walk
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = node[key];

      if (Array.isArray(value)) {
        // Recursively handle nested arrays and nodes
        const processArray = (arr: any) => {
          if (!Array.isArray(arr)) {
            // If it's not an array but an ASTNode, process it
            if (ast.isAstNode(arr)) {
              this.visit(arr, defaultVisitor);
            }
            return;
          }
          arr.forEach((item: any) => {
            if (Array.isArray(item)) {
              // Nested array, recurse
              processArray(item);
            } else if (item && ast.isAstNode(item)) {
              // It's an ASTNode, process it
              this.visit(item, defaultVisitor);
            }
          });
        };
        processArray(value);
      } else if (ast.isAstNode(value)) {
        this.visit(value, defaultVisitor);
      }
    }
    
    return result;
  }
}
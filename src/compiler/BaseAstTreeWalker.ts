import * as ast from "./frontend/ast";
import { BaseAstVisitor } from "./BaseAstVisitor";

export class BaseAstTreeWalker extends BaseAstVisitor {
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    // 1. STOP if node is null/undefined
    if (!node) return node;

    const result = {
      ...super.visit(node),
      _type: node._type,
      _location: { ...node._location },
      _parent: node._parent,
    } as any;

    // 3. Generic Walk
    for (const key of ast.getNodeIterableKeys(node)) {
      const value = node[key];

      if (Array.isArray(value)) {
        // Recursively handle nested arrays and nodes
        const mapArray = (arr: any) => {
          if (!Array.isArray(arr)) {
            // If it's not an array but an ASTNode, process it
            if (ast.isAstNode(arr)) {
              return this.visit(arr, defaultVisitor);
            }
            return arr;
          }
          return arr.map((item: any): any => {
            if (Array.isArray(item)) {
              // Nested array, recurse
              return mapArray(item);
            } else if (item && ast.isAstNode(item)) {
              // It's an ASTNode, process it
              return this.visit(item, defaultVisitor);
            } else {
              return item;
            }
          });
        };
        result[key] = mapArray(value);
      } else if (ast.isAstNode(value)) {
        result[key] = this.visit(value, defaultVisitor);
      }
    }
    return result;
  }
}
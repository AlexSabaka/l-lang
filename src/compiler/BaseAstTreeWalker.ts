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
              return this.walkPlainObject(item, defaultVisitor);
            }
          });
        };
        result[key] = mapArray(value);
      } else if (ast.isAstNode(value)) {
        result[key] = this.visit(value, defaultVisitor);
      } else {
        result[key] = this.walkPlainObject(value, defaultVisitor);
      }
    }
    return result;
  }

  /**
   * Descend into a PLAIN OBJECT that holds child nodes.
   *
   * A handful of AST fields are records rather than nodes -- they carry no `_type`, so `isAstNode` is
   * false and the walk above used to hand them back untouched, taking their children with them. That
   * made whole bodies invisible to every pass built on this walker: `catch` bodies (TryCatchFilter),
   * `handle` clause bodies + binders (HandleClause), `restart-case` arm bodies + params (RestartArm),
   * and `deftype :where` constraint values. An undefined name in any of them reported nothing at all.
   *
   * Fixing it here rather than with a `visitTryCatch`/`visitHandle`/... override per pass: an override
   * only repairs the pass that has it, and silently misses the next pass (or the next record-shaped
   * field) somebody adds.
   */
  private walkPlainObject(value: any, defaultVisitor?: (node?: ast.ASTNode) => any): any {
    if (!value || typeof value !== "object") return value;
    const out: any = Array.isArray(value) ? [] : {};
    for (const key of Object.keys(value)) {
      const child = value[key];
      if (Array.isArray(child)) {
        out[key] = child.map((item: any) =>
          item && ast.isAstNode(item) ? this.visit(item, defaultVisitor) : this.walkPlainObject(item, defaultVisitor)
        );
      } else if (child && ast.isAstNode(child)) {
        out[key] = this.visit(child, defaultVisitor);
      } else {
        out[key] = this.walkPlainObject(child, defaultVisitor);
      }
    }
    return out;
  }
}
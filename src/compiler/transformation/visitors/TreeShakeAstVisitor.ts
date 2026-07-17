import * as ast from "../../frontend/ast";
import { BaseAstTreeWalker } from "../../BaseAstTreeWalker";

/**
 * THE TRIVIAL-LIST UNWRAP USED TO LIVE HERE, and it is deleted (Yc). It read:
 *
 *     visitList(node: ast.ListNode) {
 *       if (node.nodes.length === 1) {
 *         return this.visit(node.nodes[0]);
 *       }
 *     }
 *
 * It was wrong three times over.
 *
 * 1. IT WOULD HAVE DESTROYED A D1 CALL. The unwrap is unconditional on `length === 1`, but D1 rules
 *    that `(gs[0].hi)` is a CALL while `gs[0]` is a read. This is the THIRD copy of that unwrap:
 *    codegen's `classifyList` does it correctly and D1-aware, and `DesugarAstVisitor.visitList`
 *    deleted its own copy with the note "This copy predated D1 and would have destroyed the call. Two
 *    implementations of one rule is how the compiler ends up with two answers -- and this one was the
 *    wrong answer." That verdict applies here verbatim; this copy was simply missed.
 *
 * 2. IT NEVER RAN. `BaseAstTreeWalker.visit` builds `{...super.visit(node), _type: node._type}` -- so
 *    the unwrapped node's fields were spread and the ORIGINAL `_type` stamped straight back over
 *    them. The bug in (1) was masked by a bug in the walker.
 *
 * 3. IT CORRUPTED THE TREE DOING IT. What came out was a chimera: `_type: "list"` carrying the inner
 *    node's ENTIRE field set as well as `nodes`. Every one-element list in every program -- a lambda
 *    in expression position, a class, anything -- reached the checker and codegen claiming to be a
 *    list while carrying a function's `params`/`body`/`returns`, or a class's `extends`/`implements`.
 *
 *    It works BY LUCK: every pass dispatches on `_type`, so the chimera is visited as a list, reads
 *    `nodes[0]` (the real node), and never touches the strays. The first code to read a list's
 *    non-`nodes` keys -- LL0103's return scan, in Ya -- walked straight into a lambda's own body.
 *
 * The unwrap still happens, in codegen, where it is correct and where D1 can refine it. Nothing is
 * lost by removing this, which is what (2) proves.
 *
 * WHAT REMAINS. This class no longer does anything: the `visit` override below is
 * `return super.visit(...)` written the long way, so the pass is now a deep copy of the tree and
 * nothing else -- it has never shaken a tree in its life. Kept for now rather than deleted from the
 * pipeline, because "delete a pass" is a bigger claim than "delete a bug" and deserves its own
 * measurement. Logged, not hidden.
 */
export class TreeShakeAstVisitor extends BaseAstTreeWalker {
  visit(node: ast.ASTNode, defaultVisitor?: (node?: ast.ASTNode) => any): ast.ASTNode {
    return super.visit(node, defaultVisitor);
  }
}

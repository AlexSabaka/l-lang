// HIR -> ESTree. The mechanical backend half: after lowering, control flow is already in statement
// position and value-position conditionals already carry their temps, so this is a structural map
// with NO position analysis, NO return injection, NO copy decisions, NO dispatch (hir-brief.md R6).
// The litmus test: if a case here has to make a judgment call, that judgment belongs in the lowering.
//
// Hard-fail posture (the Kotlin/JS-IR discipline): the switches are exhaustive and the default THROWS
// -- an unhandled kind is an internal invariant violation, not a user-reachable state. The acorn
// re-parse (LL0101) and the LL0100 totality net still sit below this in `compile()`.
//
// S1: skeleton. Opaque leaves and nil are wired; the modeled kinds throw until S2 implements them.

import type * as ESTree from "estree";
import type * as ast from "../frontend/ast";
import type { HBlock, HExpr, HStmt } from "./nodes";

/**
 * What the emitter is allowed to ask of the legacy JSTransformer. Deliberately narrow: leaves and the
 * two documented R6 debts (`storeValue` = the D11 copy, dies at R3) only. Everything else the emitter
 * builds itself.
 */
export interface LegacyLeafEmitter {
  /** Emit an AST subtree as an ESTree expression (JSTransformer.visitExpr). */
  leafExpr(node: ast.ASTNode): ESTree.Expression;
  /** Emit an AST subtree as an ESTree statement (coerce JSTransformer.visit). */
  leafStmt(node: ast.ASTNode): ESTree.Statement;
  /** Wrap a stored expression in the D11 value-copy when it may be a struct (JSTransformer.asValue). */
  storeValue(emitted: ESTree.Expression, src: ast.ASTNode): ESTree.Expression;
  /** The runtime nil literal for the D9 bottom value. */
  nilLiteral(src: ast.ASTNode): ESTree.Expression;
}

export class EmitHirToEstree {
  constructor(private readonly legacy: LegacyLeafEmitter) {}

  emitBlock(block: HBlock): ESTree.Statement[] {
    return block.stmts.map((s) => this.emitStmt(s));
  }

  emitStmt(h: HStmt): ESTree.Statement {
    switch (h.kind) {
      case "opaque-stmt":
        return this.legacy.leafStmt(h.src);
      default:
        throw new Error(`HIR emit: unhandled statement kind '${h.kind}' (implemented in S2)`);
    }
  }

  emitExpr(h: HExpr): ESTree.Expression {
    switch (h.kind) {
      case "opaque-expr":
        return this.legacy.leafExpr(h.src);
      case "nil":
        return this.legacy.nilLiteral(h.src);
      default:
        throw new Error(`HIR emit: unhandled expression kind '${h.kind}' (implemented in S2)`);
    }
  }
}

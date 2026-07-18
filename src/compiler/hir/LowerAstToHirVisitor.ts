// The AST -> HIR lowering pass. Runs as a Context stage after the type channel is published and
// before codegen (Context.processModule). It reads the typed AST + `context.nodeTypes` and produces a
// HirModule side-table of lowered function/program bodies; it emits nothing.
//
// Not a BaseAstVisitor subclass: that dispatch is unary `(node) -> any`, but destination-driven
// lowering is inherently `(node, dest) -> {stmts, value}`. Threading the destination down and the
// (statements, value) pair back through instance fields is exactly the ambient-state pattern this
// codebase has spent phases removing, so the pass owns its own recursion (as DesugarAstVisitor does).
//
// S1: the pass is a stub that lowers nothing -- every body falls back to the legacy emitter, so the
// HIR path (flag on) is byte-identical to the legacy path (flag off). S2 fills in the destination
// engine, blocks/bodies, and the if/when/cond lowering.

import type { Context } from "../Context";
import type * as ast from "../frontend/ast";
import { HirModule } from "./HirModule";
import { TempAllocator } from "./TempAllocator";

export class LowerAstToHirVisitor {
  private readonly temps = new TempAllocator();

  constructor(private readonly context: Context) {}

  /** Lower a program's function bodies (and its top level) into a HirModule side-table. */
  lower(_root: ast.ASTNode): HirModule {
    // S1: empty module. The `temps`/`context` wiring is in place for S2.
    void this.temps;
    void this.context;
    return new HirModule();
  }
}

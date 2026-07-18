import type * as ast from "../frontend/ast";
import type { HBlock } from "./nodes";

/**
 * The lowering pass's output: a side-table of lowered bodies, keyed by the AST node whose body was
 * lowered -- a `FunctionNode`, or the `ProgramNode` for the top level. Keyed by node IDENTITY, the
 * same discipline as `context.nodeTypes`: the codegen seam looks a body up by the very node it is
 * about to emit.
 *
 * A MISSING entry is the always-correct fallback -- the body was not lowered (an unsupported
 * construct, or the HIR path is off) and codegen emits it the legacy way. Nothing here ever forces
 * the new path; the side-table only ever ADDS the option to take it.
 */
export class HirModule {
  private readonly bodies = new Map<ast.ASTNode, HBlock>();

  set(owner: ast.ASTNode, body: HBlock): void {
    this.bodies.set(owner, body);
  }

  /** The lowered body for `owner`, or undefined -- undefined means "emit the legacy way". */
  bodyFor(owner: ast.ASTNode): HBlock | undefined {
    return this.bodies.get(owner);
  }

  get size(): number {
    return this.bodies.size;
  }
}

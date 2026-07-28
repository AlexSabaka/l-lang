// The C backend entry point -- the `language: "c"` analog of JSTransformerAstVisitor.compile().
//
// Orchestrates the C pipeline over the SHARED, backend-neutral HIR:
//   HIR -(P1 ResolveHirToCir)-> CIR -(P2 InsertCoercions)-> CIR+casts -(P3 EmitCirToC)-> C
//
// Output is a single self-contained C11 translation unit (the JS shim model, mirrored): the runtime
// text prepended, then forward decls, user functions, and `int main(void)` holding the top-level
// statements in order. Compile with `cc -std=c11 out.c -o out -lm`.
//
// The GapLedger collected across P1/P2 is the probe's real product; dump it with the
// LL_GAP_LEDGER=<path> environment variable (the C runner aggregates per-file ledgers).

import * as fs from "node:fs";
import * as path from "node:path";
import type { Context } from "../../Context";
import type * as ast from "../../frontend/ast";
import { report, CBackendDiagnostics } from "../../rules/diagnostics";
import { GapLedger } from "./GapLedger";
import { ResolveHirToCir } from "./ResolveHirToCir";
import { InsertCoercions } from "./InsertCoercions";
import { EmitCirToC, EmitRefusal } from "./EmitCirToC";
import { CRuntimeProvider } from "./CRuntimeProvider";

export class CTransformer {
  readonly ledger = new GapLedger();

  constructor(private readonly context: Context) {}

  compile(root: ast.ASTNode): { code: string; map: null } {
    const hir = this.context.hir;
    if (!hir) throw new Error("C backend: HIR lowering did not run (Context wiring bug)");

    const resolver = new ResolveHirToCir(this.context, hir, this.ledger);
    const cir = resolver.resolveModule(root);
    if (cir === null || this.context.results.hasErrors) {
      // A refusal (LL0105/06/07) was reported; the driver suppresses output and exits 1.
      this.dumpLedger();
      return { code: "", map: null };
    }

    const coerced = new InsertCoercions(this.ledger).run(cir);

    // P3 can still meet a construct it cannot PRINT. Reported as the same LL0106 P1 reports, rather
    // than escaping as an uncaught exception: a user who writes an unimplemented shape gets a
    // diagnostic naming it and pointing at their source, not a TypeScript stack trace naming
    // `EmitCirToC.ts:977`.
    let body: string;
    try {
      body = new EmitCirToC().emitModule(coerced);
    } catch (e) {
      if (!(e instanceof EmitRefusal)) throw e;
      report(this.context, CBackendDiagnostics.Unhandled, (e.node ?? root) as ast.ASTNode, {
        type: e.what,
        where: "EmitCirToC",
      });
      this.ledger.record("new", `unhandled:${e.what}`, (e.node ?? root) as ast.ASTNode, "no C emission (EmitCirToC)");
      this.dumpLedger();
      return { code: "", map: null };
    }
    this.dumpLedger();

    return { code: CRuntimeProvider.runtimeText() + "\n" + body, map: null };
  }

  private dumpLedger(): void {
    const target = process.env.LL_GAP_LEDGER;
    if (!target) return;
    try {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, this.ledger.toJSON());
    } catch {
      // The ledger is telemetry; never fail a compile over it.
    }
  }
}

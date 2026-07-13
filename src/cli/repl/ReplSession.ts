import * as vm from "node:vm";
import * as fs from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { Context, CompilerOptions } from "../../compiler/Context";
import { RuntimeProvider } from "../../compiler/runtime/RuntimeProvider";

/**
 * The REPL's compile-and-evaluate core.
 *
 * Headless BY CONTRACT: no chalk, no readline, no `process.stdout`. It takes a string and returns
 * plain data. Everything the user actually sees is `ReplRenderer`'s job, and the readline plumbing
 * is `command.repl.ts`'s. That split is the point -- the old `PersistentREPLContext` had the
 * compiler, the sandbox, the colours and the printing tangled together, which is why the REPL could
 * not be tested without a terminal, and therefore never was.
 *
 * ============================================================================================
 * PHASE 1 (this file, right now): the INTERFACE is final; the IMPLEMENTATION is a faithful copy
 * of the broken behaviour it replaces -- temp file in tmpdir, `__repl_marker`, split the emitted
 * JavaScript on a marker string, never read `context.results`, never rebuild the sandbox on reset.
 *
 * That is deliberate. `src/test/repl.ts` asserts against this interface and must go RED for the
 * REAL defects, not because the seam is a stub. Phase 2 guts the body; the signatures stay put.
 * ============================================================================================
 */

export type ReplSeverity = "error" | "warning" | "message";

/** Where a diagnostic actually lives, from the user's point of view -- not the replayed program's. */
export type DiagnosticOrigin =
  /** In the line the user just typed. `line`/`column` are relative to THAT input. */
  | { kind: "input"; line: number; column: number }
  /** In a form the user typed earlier, and already accepted. `cell` indexes `cells`. */
  | { kind: "history"; cell: number; source: string; line: number }
  /** In an imported file. Passed through untouched. */
  | { kind: "file"; file: string; line: number; column: number };

export interface ReplDiagnostic {
  code: string;
  severity: ReplSeverity;
  text: string;
  origin: DiagnosticOrigin;
}

export type ReplResult =
  /** It compiled, it ran, it produced a value (possibly `undefined`). `warnings` may be non-empty. */
  | { kind: "value"; value: unknown; output: string[]; warnings: ReplDiagnostic[] }
  /** The compiler refused it. NOTHING was executed; the session is exactly as it was. */
  | { kind: "refused"; diagnostics: ReplDiagnostic[]; output: string[] }
  /** It compiled, but the emitted JavaScript threw. The session is exactly as it was. */
  | { kind: "runtime-error"; error: Error; output: string[] };

/** One accepted input. The session's program is the cells, in order, as sibling top-level forms. */
export interface Cell {
  index: number;
  source: string;
  /** Names this cell declares at top level. Drives `.delete`. */
  declares: string[];
}

export type DeleteOutcome =
  | { kind: "deleted"; cell: Cell }
  | { kind: "not-found"; name: string };

export class ReplSession {
  private options: CompilerOptions;
  private context: Context;
  private sandbox: vm.Context;
  private output: string[] = [];
  private cellList: Cell[] = [];
  private tempFile: string;

  constructor(options: CompilerOptions) {
    this.options = {
      ...options,
      noIIFE: true, // top-level bindings must land on the sandbox global, as `var`
      includeRuntimeShim: false, // the shim is loaded once, into the sandbox, below
    };

    this.tempFile = path.resolve(tmpdir(), `llang-repl-${Date.now()}.lisp`);
    this.context = new Context(this.tempFile, this.options);
    this.sandbox = this.newSandbox();
  }

  get cells(): readonly Cell[] {
    return this.cellList;
  }

  getContext(): Context {
    return this.context;
  }

  eval(source: string): ReplResult {
    this.output = [];

    // PHASE 1: verbatim from PersistentREPLContext.eval. Every defect below is load-bearing for
    // the gate -- see the RED cases in src/test/repl.ts that each of them causes.
    const markerValue = `---boundary-${this.cellList.length}-${Math.random().toString(36).slice(2)}---`;
    const markerLisp = `(let __repl_marker "${markerValue}")`;
    const markerJs = `var __repl_marker = "${markerValue}";`;

    try {
      const program = [...this.cellList.map((c) => c.source), markerLisp, source].join("\n\n");
      fs.writeFileSync(this.tempFile, program);

      this.context = new Context(this.tempFile, this.options);
      const result: any = this.context.process(this.tempFile, "codegen");

      // B2: `context.results` is never consulted, so a refusal is indistinguishable from a form
      // that legitimately produced nothing. The prompt just comes back. Phase 3.
      if (!result.code) {
        return { kind: "value", value: undefined, output: this.output, warnings: [] };
      }

      // B5: a textual split. If it ever misses, `.pop()` hands back the WHOLE program and every
      // form in history re-executes. Phase 2 replaces this with a structural slice.
      const parts = String(result.code).split(markerJs);
      const tail = parts[parts.length - 1].trim();
      if (!tail) {
        return { kind: "value", value: undefined, output: this.output, warnings: [] };
      }

      const value = vm.runInContext(tail, this.sandbox);

      this.cellList.push({ index: this.cellList.length, source, declares: [] });

      // The value/output conflation: a form that BOTH logs and returns loses its value.
      const logged = this.output.length > 0;
      return {
        kind: "value",
        value: logged ? undefined : value,
        output: this.output,
        warnings: [],
      };
    } catch (error: any) {
      return { kind: "runtime-error", error, output: this.output };
    }
  }

  /**
   * PHASE 1: B4, preserved. History and the Context are rebuilt; the SANDBOX is not, so every
   * `var` the user ever defined survives a `.reset`. Phase 4 routes this through a real rebuild.
   */
  reset(): void {
    this.cellList = [];
    this.context = new Context(this.tempFile, this.options);
    this.loadRuntimeShim(this.sandbox);
  }

  /** PHASE 4. Declared now so the gate can assert against it; unimplemented on purpose. */
  delete(name: string): DeleteOutcome {
    return { kind: "not-found", name };
  }

  symbols(): Map<string, any> {
    const symbols = new Map<string, any>();
    const table = this.context.symbolTable;
    if (!table) return symbols;

    for (const [name, entry] of table.getAllSymbols().entries()) {
      symbols.set(name, {
        type: entry.nodeType,
        mutability: entry.mutability,
        visibility: entry.visibility,
        inferredType: entry.inferredType,
      });
    }
    return symbols;
  }

  dispose(): void {
    try {
      if (fs.existsSync(this.tempFile)) fs.rmSync(this.tempFile);
    } catch {
      /* a temp file we cannot remove is not worth failing the session over */
    }
  }

  // -----------------------------------------------------------------------------------------

  private newSandbox(): vm.Context {
    const sandbox = vm.createContext({
      console: {
        // PHASE 1: JSON.stringify, preserved. It means the SAME program prints differently in the
        // REPL than it does under `node` -- `[1 2]` renders as a pretty-printed JSON array here and
        // as `[ 1, 2 ]` there. Phase 2 switches to util.formatWithOptions.
        log: (...args: any[]) => {
          this.output.push(
            args
              .map((a) => (typeof a === "object" ? JSON.stringify(a, null, 2) : String(a)))
              .join(" ")
          );
        },
        error: (...args: any[]) => this.output.push(args.map(String).join(" ")),
        warn: (...args: any[]) => this.output.push(args.map(String).join(" ")),
      },
      JSON,
      Math,
      process,
      require,
    });

    this.loadRuntimeShim(sandbox);
    return sandbox;
  }

  private loadRuntimeShim(sandbox: vm.Context): void {
    // PHASE 1: the let/const -> var regex, preserved. It is not a workaround, it is a bug: an
    // unanchored global replace over the whole shim, so it also rewrites `let`/`const` INSIDE the
    // shim's own function bodies and loops, changing their semantics. Phase 2 loads it verbatim.
    const shim = RuntimeProvider.getRuntimeShim()
      .replace(/const\s+/g, "var ")
      .replace(/let\s+/g, "var ");

    vm.runInContext(shim, sandbox);
  }
}

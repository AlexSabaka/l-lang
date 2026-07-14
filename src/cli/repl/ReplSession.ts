import * as vm from "node:vm";
import * as fs from "node:fs";
import * as path from "node:path";
import * as util from "node:util";
import { generate } from "astring";
import type * as ESTree from "estree";

import { Context, CompilerOptions } from "../../compiler/Context";
import { RuntimeProvider } from "../../compiler/runtime/RuntimeProvider";
import { JSTransformerAstVisitor } from "../../compiler/codegen/js-estree/visitors/JSTransformerAstVisitor";
import { RuleSeverity } from "../../compiler/rules/RuleBuilder";
import * as ast from "../../compiler/frontend/ast";

/**
 * The REPL's compile-and-evaluate core.
 *
 * Headless BY CONTRACT: no chalk, no readline, no `process.stdout`. It takes a string and returns
 * plain data. What the user sees is `ReplRenderer`'s job; the readline plumbing is
 * `command.repl.ts`'s. That split is the point -- the old `PersistentREPLContext` had the compiler,
 * the sandbox, the colours and the printing tangled together, which is why the REPL could not be
 * tested without a terminal, and therefore never was.
 *
 * ## The model
 *
 * A session is a program that grows by one top-level form at a time. Each accepted input is a
 * CELL, and the session's program is the cells, in order, as SIBLING top-level forms.
 *
 * Every input recompiles the whole thing. That is not laziness -- in a statically typed language it
 * is the only sound thing to do: binding `x` to a String has to be checked against every form that
 * already uses `x`. But only the NEW form is ever executed; history is compiled, never re-run. The
 * values it produced are already in the sandbox.
 *
 * ## How the new form is separated from history -- and why not the obvious way
 *
 * The old code inserted a marker form, compiled everything, and split the emitted JAVASCRIPT on a
 * marker string. That is what broke the REPL outright: the marker was named `__repl_marker`, and
 * grammar_v2's `Underscore` token eats the leading `_` of any `__`-prefixed identifier, so every
 * input failed to parse. It was also unguarded -- if the split ever missed, `.pop()` returned the
 * whole program and all of history re-executed.
 *
 * Instead: the session BUILDS the program text, so it knows the exact byte offset where the new
 * input begins. Top-level nodes are sliced by `_location.start.offset`. Offsets survive the whole
 * pipeline (desugar shallow-copies `_location` verbatim), and unlike node INDEXES they are immune to
 * passes that add or remove nodes -- which comptime does. DECISIONS.md already relies on exactly
 * this property for map and enum keys, and for the same reason.
 *
 * ## VISIT ALL, EMIT SOME
 *
 * The transformer must nonetheless walk the WHOLE program. It accumulates `this.classes`,
 * `this.functions` and `this.enumKeys` *as it visits declarations*, and reads them back to decide
 * whether `(P 1 2)` is `new P(1, 2)` or `P(1, 2)`. Hand it only the new nodes and those
 * accumulators are empty, so a class defined in an earlier cell compiles to a bare call and throws
 * `TypeError: Class constructor P cannot be invoked without 'new'`. So: visit every top-level node,
 * keep the ESTree of the tail ones only.
 */

export type ReplSeverity = "error" | "warning" | "message";

/** Where a diagnostic lives from the USER's point of view -- not the replayed program's. */
export type DiagnosticOrigin =
  | { kind: "input"; line: number; column: number }
  | { kind: "history"; cell: number; source: string; line: number }
  | { kind: "file"; file: string; line: number; column: number };

export interface ReplDiagnostic {
  code: string;
  severity: ReplSeverity;
  text: string;
  origin: DiagnosticOrigin;
}

export type ReplResult =
  | { kind: "value"; value: unknown; output: string[]; warnings: ReplDiagnostic[] }
  /** The compiler refused it. NOTHING ran; the session is exactly as it was. */
  | { kind: "refused"; diagnostics: ReplDiagnostic[]; output: string[] }
  /** It compiled, but the emitted JavaScript threw. The session is exactly as it was. */
  | { kind: "runtime-error"; error: Error; output: string[] };

export interface ReplSymbol {
  kind: string;
  type: string;
  mutable: boolean;
}

export interface Cell {
  index: number;
  source: string;
  /** Names this cell declares at top level. Drives `.delete`. */
  declares: string[];
}

export type DeleteOutcome =
  | {
      kind: "deleted";
      removed: Cell;
      /** Other names the removed cell also declared. They are gone too, and the user must be told. */
      alsoRemoved: string[];
      /** Cells that no longer compile without it, and were therefore dropped. Loudly, never silently. */
      broke: string[];
    }
  | { kind: "not-found"; name: string };

/** Where one cell sits in the assembled program text. */
interface Span {
  index: number;
  startOffset: number;
  /** 1-based, into the assembled program. */
  startLine: number;
  source: string;
}

const RESULT_VAR = "__ll_repl_result";

/** The l-lang declaration forms that bind a name at top level. Drives `declares` and `.delete`. */
const DECLARING: ReadonlySet<string> = new Set([
  "variable",
  "function",
  "class",
  "struct",
  "enum",
  "interface",
  "type",
  "modifier",
]);

export class ReplSession {
  private options: CompilerOptions;
  private context: Context;
  private sandbox: vm.Context;
  private output: string[] = [];
  private cellList: Cell[] = [];
  /** name -> the type it was first bound at. Enforces D17's one-name-one-type. See retypes(). */
  private types = new Map<string, string>();
  /** The JavaScript the last accepted cell compiled to. Powers a bare `.js`. */
  private lastJs = "";
  private readonly file: string;

  /**
   * The program is written HERE, in the working directory -- not in os.tmpdir().
   *
   * `AstProvider` can only read source from disk (there is no compile-a-string entry point), so a
   * file has to exist. It matters *where*: imports resolve against
   * `path.dirname(currentFile)`, so while the program lived in the temp dir, EVERY relative import
   * in the REPL resolved into the temp dir and could not be found.
   */
  constructor(options: CompilerOptions, cwd: string = process.cwd()) {
    this.options = {
      ...options,
      noIIFE: true, // top-level bindings land on the sandbox global, as `var`
      includeRuntimeShim: false, // the shim is loaded once, into the sandbox, below
      stage: "types", // we drive codegen ourselves; see emitTail()
    };

    this.file = path.resolve(cwd, ".llang-repl.lisp");
    this.context = new Context(this.file, this.options);
    this.sandbox = this.newSandbox();
  }

  get cells(): readonly Cell[] {
    return this.cellList;
  }

  /** The JavaScript the last accepted form compiled to. */
  get emittedJs(): string {
    return this.lastJs;
  }

  getContext(): Context {
    return this.context;
  }

  /**
   * Compile `source` as the session's next form. Does not run it and does not touch history.
   *
   * Shared by eval(), `.js` and `.type` -- all three need exactly this and nothing more.
   */
  private build(
    source: string
  ):
    | { ok: true; ctx: Context; js: string; tail: ast.ASTNode[]; spans: Span[] }
    | { ok: false; diagnostics: ReplDiagnostic[] } {
    const spans = this.layout(source);
    const tailStart = spans[spans.length - 1].startOffset;

    fs.writeFileSync(this.file, spans.map((s) => s.source).join("\n\n"));

    const ctx = new Context(this.file, this.options);
    this.context = ctx;

    let root: ast.ProgramNode;
    try {
      root = ctx.process(this.file, "types").ast as ast.ProgramNode;
    } catch (e: any) {
      // The lexer and the parser THROW rather than reporting; everything after them reports.
      return { ok: false, diagnostics: [this.fromThrow(e, spans)] };
    }

    // B2: the thing the old REPL never did. `Context.processModule` deliberately does not log --
    // the CLI is meant to (see command.run.ts) -- and the REPL never read `results`, so a refusal
    // printed nothing at all and the prompt just came back.
    if (ctx.results.hasErrors) {
      return { ok: false, diagnostics: this.collect(ctx, spans) };
    }

    try {
      const { js, tail } = this.emitTail(ctx, root, tailStart);
      return { ok: true, ctx, js, tail, spans };
    } catch (e: any) {
      return { ok: false, diagnostics: [this.fromThrow(e, spans)] };
    }
  }

  /** The JavaScript `source` compiles to, without running it. Powers `.js`. */
  compileOnly(source: string): { kind: "js"; js: string } | { kind: "refused"; diagnostics: ReplDiagnostic[] } {
    const built = this.build(source);
    return built.ok ? { kind: "js", js: built.js } : { kind: "refused", diagnostics: built.diagnostics };
  }

  /**
   * The type `source` infers to, without running it. Powers `.type`.
   *
   * Binds the expression to a throwaway name and reads that name's type back out -- which works for
   * a bare identifier (`.type x`) and an arbitrary expression (`.type (+ 1 2)`) alike. The probe
   * never enters history, so it cannot collide with anything or trip the REPL0001 guard.
   *
   * The name deliberately has no leading underscores: `__probe` would not tokenize (grammar_v2's
   * Underscore token eats the first `_` of a `__`-prefixed identifier -- the bug that killed the old
   * REPL, still live in the compiler, see docs/inbox/).
   */
  inferType(source: string): { kind: "type"; type: string } | { kind: "refused"; diagnostics: ReplDiagnostic[] } {
    const probe = "replTypeProbe";
    const built = this.build(`(let ${probe} ${source})`);
    if (!built.ok) return { kind: "refused", diagnostics: built.diagnostics };
    return { kind: "type", type: typeOf(built.ctx, probe) ?? "?" };
  }

  eval(source: string): ReplResult {
    this.output = [];

    const built = this.build(source);
    if (!built.ok) return { kind: "refused", diagnostics: built.diagnostics, output: [] };

    const ctx = built.ctx;
    const emitted = { js: built.js, tail: built.tail };
    const spans = built.spans;

    const declares = declaredNames(emitted.tail);
    const clash = this.retypes(ctx, declares);
    if (clash) return { kind: "refused", diagnostics: [clash], output: [] };

    let value: unknown;
    try {
      vm.runInContext(emitted.js, this.sandbox, { filename: "<repl>" });
      value = (this.sandbox as any)[RESULT_VAR];
    } catch (error: any) {
      // It compiled but blew up. History stays exactly as it was: replaying a form whose side
      // effects only half-happened would compile against a world that never existed.
      return { kind: "runtime-error", error, output: this.output };
    }

    this.lastJs = emitted.js;
    this.cellList.push({ index: this.cellList.length, source, declares });
    for (const name of declares) {
      const t = typeOf(ctx, name);
      if (t) this.types.set(name, t);
    }

    return {
      kind: "value",
      value,
      output: this.output,
      warnings: this.collect(ctx, spans).filter((d) => d.severity !== "error"),
    };
  }

  /**
   * Refuse a rebinding that would give an existing name a DIFFERENT type. D17: one name, one
   * symbol, one type, for the life of the session.
   *
   * This is not belt-and-braces, it is load-bearing, and it closes a SILENT WRONG ANSWER.
   *
   * A session's cells are sibling top-level forms (they must be -- an outer list would make each
   * cell a block and turn every rebind into LL0212). So `(let x 1)` … `(let x "hi")` puts TWO
   * declarations of `x` at program scope, with different types -- while codegen emits ONE `var x`.
   * The checker then resolves `(* x 2)` inside an earlier `(fn double [] -> Int ...)` against the
   * FIRST `x` (Int) and says nothing, and at run time `double` reads the String and returns `null`.
   * A function declared `-> Int` returning null, with zero diagnostics.
   *
   * The compiler does not catch it, and cannot be expected to: in a FILE this shape is impossible
   * (one top-level block, so a redeclaration is LL0212), and a forward reference from a function
   * body to a `let` declared later at program scope is not type-checked either -- so dropping the
   * earlier cell does not restore the check. MEASURED both ways.
   *
   * LL0200 used to fire here, because the checker read the second `let` as an ASSIGNMENT to the
   * existing symbol. P6 made resolution scope-aware and it now reads it as a second declaration, so
   * the accidental guard is gone. Hence this one, which does not depend on how the checker happens
   * to resolve anything.
   */
  private retypes(ctx: Context, declares: string[]): ReplDiagnostic | undefined {
    for (const name of declares) {
      const was = this.types.get(name);
      const now = typeOf(ctx, name);
      if (!was || !now || was === now) continue;

      return {
        code: "REPL0001",
        severity: "error",
        text:
          `'${name}' is ${was} in this session and cannot become ${now}. ` +
          `Anything already compiled against it would keep reading it as ${was}. ` +
          `Use \`.delete ${name}\` first.`,
        origin: { kind: "input", line: 1, column: 1 },
      };
    }
    return undefined;
  }

  reset(): void {
    this.cellList = [];
    this.types.clear();
    this.context = new Context(this.file, this.options);
    // B4: the old reset() rebuilt the Context but REUSED the sandbox, so every `var` the user had
    // ever defined survived it. A reset that leaves the bindings behind is not a reset.
    this.sandbox = this.newSandbox();
  }

  /**
   * Remove the cell that declares `name`, and rebuild the session without it.
   *
   * This is not a convenience. A binding's TYPE IS FIXED AT FIRST DECLARATION -- the checker reads
   * a second `(let x ...)` as an assignment to the existing symbol, so `(let x 1)` then
   * `(let x "hi")` is refused (LL0200) no matter what else is in the session. `.delete x` is the
   * ONLY way to give `x` a different type without throwing the whole session away.
   *
   * The sandbox must be rebuilt, not patched: a `var` on a contextified global cannot be reliably
   * removed. So the surviving cells are replayed into a fresh one. A cell that no longer compiles
   * without the deleted declaration is DROPPED and REPORTED -- never silently kept, and never
   * silently discarded.
   */
  delete(name: string): DeleteOutcome {
    const index = this.cellList.findIndex((c) => c.declares.includes(name));
    if (index < 0) return { kind: "not-found", name };

    const removed = this.cellList[index];
    const survivors = this.cellList.filter((_, i) => i !== index).map((c) => c.source);

    const broke = this.replay(survivors);

    return {
      kind: "deleted",
      removed,
      alsoRemoved: removed.declares.filter((n) => n !== name),
      broke,
    };
  }

  /** Rebuild the sandbox and re-run `sources` into it. Returns the ones that no longer compile. */
  private replay(sources: string[]): string[] {
    this.sandbox = this.newSandbox();
    this.cellList = [];
    this.types.clear();

    const broke: string[] = [];
    for (const source of sources) {
      const before = this.cellList.length;
      this.eval(source);
      // eval() only pushes a cell when the form compiled AND ran. If the count did not move, this
      // form depended on what we just deleted.
      if (this.cellList.length === before) broke.push(source);
    }

    this.output = [];
    return broke;
  }

  /**
   * What THIS SESSION has defined.
   *
   * Built from the cells, not from `symbolTable.getAllSymbols()`. The symbol table holds every
   * symbol in the program -- including function PARAMETERS and locals -- so `.symbols` used to list
   * `a, b` from inside `(fn add [a b] ...)` as though you had defined them at the prompt. You had
   * not. Asking the cells what they declared is both correct and cheaper.
   */
  symbols(): Map<string, ReplSymbol> {
    const out = new Map<string, ReplSymbol>();
    const all = this.context.symbolTable?.getAllSymbols?.() ?? new Map();

    for (const cell of this.cellList) {
      for (const name of cell.declares) {
        const entry: any = all.get(name);
        out.set(name, {
          kind: entry?.nodeType ?? "value",
          type: this.types.get(name) ?? typeOf(this.context, name) ?? "?",
          mutable: Boolean(entry?.mutability && String(entry.mutability) !== "immutable"),
        });
      }
    }
    return out;
  }

  /**
   * Read a `.lisp` file and feed its top-level forms in as cells.
   *
   * A file written the conventional way is wrapped in ONE outer list -- and that outer list is a
   * BLOCK (D17). Loaded as a single cell, every binding in it would be block-scoped and invisible to
   * the next prompt, which is exactly the wrong thing. So a wrapper is unwrapped and its forms
   * become sibling cells, which is what a session is.
   *
   * Known limit: a relative `import` inside the loaded file resolves against the session's working
   * directory, not the file's own -- the session compiles one program, and it lives at the cwd.
   */
  load(file: string): { kind: "loaded"; results: Array<{ source: string; result: ReplResult }> } | { kind: "error"; message: string } {
    const abs = path.resolve(file);
    if (!fs.existsSync(abs)) return { kind: "error", message: `no such file: ${file}` };

    const text = fs.readFileSync(abs, { encoding: "utf-8" });

    let top: ast.ASTNode[];
    try {
      const ctx = new Context(abs, { ...this.options, stage: "parse" });
      top = (ctx.process(abs, "parse").ast as ast.ProgramNode).program;
    } catch (e: any) {
      return { kind: "error", message: String(e?.message ?? e).split("\n")[0] };
    }

    // Unwrap the conventional `( ...forms... )` file wrapper -- but ONLY that. A single form whose
    // children are not all lists (a call, an operator application) is left alone. Comments are
    // children too, and must not be counted when deciding.
    if (top.length === 1 && top[0]._type === "list") {
      const kids: any[] = ((top[0] as any).nodes ?? []).filter((k: any) => k?._type !== "comment");
      if (kids.length > 1 && kids.every((k) => k?._type === "list")) top = kids;
    }

    const results: Array<{ source: string; result: ReplResult }> = [];
    for (const node of top) {
      if (node._type === "comment") continue;

      const start = node._location?.start?.offset;
      const end = node._location?.end?.offset;
      if (start === undefined || end === undefined) continue;

      // `end.offset` is INCLUSIVE -- it indexes the form's last character, not one past it. Slicing
      // to `end` drops the closing paren and the form no longer parses. (RuleBuilder.getSource has
      // the same off-by-one, which is why a diagnostic's source excerpt loses its last character;
      // see docs/inbox/.)
      const source = text.slice(start, end + 1).trim();
      if (!source) continue;

      results.push({ source, result: this.eval(source) });
    }

    return { kind: "loaded", results };
  }

  /**
   * The members of `name`'s type, for member completion.
   *
   * Read from `__ll_type_metadata` -- the table the program itself compiled and the runtime's own
   * `(type ...)` reflection reads. The old completer guessed from a hardcoded list of JavaScript
   * methods (`push`, `hasOwnProperty`, ...), which is not what an l-lang class has.
   */
  membersOf(name: string): string[] {
    const sym = this.symbols().get(name);
    if (!sym) return [];

    const table: any = (this.sandbox as any)[RuntimeProvider.TYPES_METADATA_VAR] ?? {};
    const meta = table[sym.type];
    if (!meta) return [];

    return [...(meta.properties ?? []), ...(meta.methods ?? [])]
      .map((m: any) => (typeof m === "string" ? m : m?.name))
      .filter((m: any): m is string => typeof m === "string");
  }

  dispose(): void {
    try {
      if (fs.existsSync(this.file)) fs.rmSync(this.file);
    } catch {
      /* a scratch file we cannot remove is not worth failing the session over */
    }
  }

  // ===========================================================================================
  // The sandbox
  // ===========================================================================================

  private newSandbox(): vm.Context {
    // `console.log` must format the way node does. The old REPL used
    // `JSON.stringify(arg, null, 2)`, so the SAME program printed differently at the prompt than it
    // did under `node` -- `[1 2]` came out as a pretty-printed JSON array here and as `[ 1, 2 ]`
    // there. Two spellings, two answers, which is the bug class this compiler exists to refuse.
    // The braces matter. As a bare arrow expression this returns `Array.push`'s value -- the new
    // LENGTH -- so `(console.log "hi")` answered `=> 1` instead of printing and yielding nothing.
    const log = (...args: any[]): void => {
      this.output.push(util.formatWithOptions({ colors: false, depth: null }, ...args));
    };

    const sandbox = vm.createContext({
      console: { log, error: log, warn: log },
      [RESULT_VAR]: undefined,
      JSON,
      Math,
      process,
      require,
    });

    // The shim is loaded ONCE, and VERBATIM.
    //
    // The old code ran `.replace(/const\s+/g, 'var ').replace(/let\s+/g, 'var ')` over it first.
    // That is not a workaround, it is a bug: an unanchored global replace over the whole shim text,
    // so it also rewrote `let`/`const` inside the shim's own function bodies and loops, quietly
    // changing their scoping. It was never needed either -- a top-level `let` in a vm script lands
    // in the realm's global lexical environment and IS visible to later scripts in the same context.
    vm.runInContext(RuntimeProvider.getRuntimeShim(), sandbox);
    return sandbox;
  }

  // ===========================================================================================
  // Compile
  // ===========================================================================================

  /** Where every cell lands in the assembled program. The structural replacement for the marker. */
  private layout(source: string): Span[] {
    const sources = [...this.cellList.map((c) => c.source), source];
    const spans: Span[] = [];

    let offset = 0;
    let line = 1;
    for (let i = 0; i < sources.length; i++) {
      spans.push({ index: i, startOffset: offset, startLine: line, source: sources[i] });
      offset += sources[i].length + 2; // the "\n\n" the cells are joined with
      line += countLines(sources[i]) + 1;
    }
    return spans;
  }

  /**
   * Visit every top-level node; keep the ESTree of the tail ones.
   *
   * See the class doc: the transformer's `classes`/`functions`/`enumKeys` accumulators are filled
   * BY the walk and read back to decide what a call means, so skipping history's nodes miscompiles
   * every reference into it.
   */
  private emitTail(
    ctx: Context,
    root: ast.ProgramNode,
    tailStart: number
  ): { js: string; tail: ast.ASTNode[] } {
    const tx = new JSTransformerAstVisitor(ctx);

    const body: ESTree.Statement[] = [];
    const tail: ast.ASTNode[] = [];

    for (const node of root.program) {
      const es = tx.visit(node) as any;
      if (!es) continue;

      if ((node._location?.start?.offset ?? 0) < tailStart) continue; // history: visited, not emitted

      tail.push(node);
      body.push(deLexicalize(isStatement(es) ? es : expressionStatement(es)));
    }

    // These are private on the transformer, and `visitProgram`/`compile` -- which we deliberately
    // do not call -- are what normally drain them. Reading them here is the price of driving
    // codegen from outside the compiler. See docs/inbox/compiler-notes-from-repl.md, which asks for
    // them to be made public.
    const inlined = Object.values((tx as any).inlinedDefinitions ?? {}) as ESTree.Statement[];
    const operators = ((tx as any).operatorRegistrations ?? []) as ESTree.Statement[];
    (tx as any).populateTypesMetadata?.();

    // captureResult MUTATES `body` (it pops a trailing expression statement so it can be re-emitted
    // as an assignment). Call it BEFORE the spread below -- `[...body, ...captureResult(body)]`
    // spreads `body` first, so the popped statement is already copied in and the expression runs
    // TWICE. Every console.log fired twice.
    const capture = captureResult(body);

    const program: ESTree.Program = {
      type: "Program",
      sourceType: "script",
      // No "use strict" directive. `compile()` prepends one, and a directive is a NON-EMPTY
      // completion value -- so `var x = 5;`, whose own completion is empty, would make the script
      // evaluate to the string "use strict". We do not read completion values anyway (see
      // captureResult), but emitting the directive here would buy nothing and cost that trap.
      body: [...operators, ...inlined, ...body, ...capture],
    };

    // Types metadata: the shim is loaded with includeRuntimeShim:false, so its `__ll_type_metadata`
    // table is never initialised and `(type Foo)` sees nothing. Refresh it from the symbol table on
    // every eval -- new cells can declare new types.
    // Assign, never declare: the shim opens with `let __ll_type_metadata = {}`, so a `var` of the
    // same name is a redeclaration SyntaxError. This mirrors what the compiler's own `metadataInit`
    // emits (RuntimeProvider.ts) -- a plain assignment. Merge rather than replace, since each cell
    // can add types without invalidating the ones already in there.
    const metadata = tx.getTypesMetadata?.() ?? {};
    const MD = RuntimeProvider.TYPES_METADATA_VAR;
    vm.runInContext(`${MD} = Object.assign(${MD}, ${JSON.stringify(metadata)});`, this.sandbox);

    return { js: generate(program as any), tail };
  }

  // ===========================================================================================
  // Diagnostics
  // ===========================================================================================

  private collect(ctx: Context, spans: Span[]): ReplDiagnostic[] {
    return ctx.results.all.map((m) => ({
      code: String(m.code),
      severity: severityOf(m.severity),
      text: sentenceOf(m),
      origin: this.locate(String(m.source ?? ""), m.line, 1, spans),
    }));
  }

  private fromThrow(e: any, spans: Span[]): ReplDiagnostic {
    // The lexer/parser throw `new Error("file:line:col: message")` -- a string-formatted error with
    // no structured position. Scraping it is the only route today; the inbox note asks for a typed
    // ParseError so this can go.
    const m = /^(.*?):(\d+):(\d+):\s*([\s\S]*)$/.exec(String(e?.message ?? e));
    if (!m) {
      return {
        code: "LL0000",
        severity: "error",
        text: String(e?.message ?? e).split("\n")[0],
        origin: { kind: "input", line: 1, column: 1 },
      };
    }
    return {
      code: "LL0000",
      severity: "error",
      text: m[4].split("\n")[0].trim(),
      origin: this.locate(m[1], Number(m[2]), Number(m[3]), spans),
    };
  }

  /** Map a position in the ASSEMBLED program back to the cell the user actually typed. */
  private locate(source: string, line: number, column: number, spans: Span[]): DiagnosticOrigin {
    if (path.resolve(source || "") !== this.file) {
      return { kind: "file", file: source, line, column };
    }

    let span = spans[0];
    for (const s of spans) if (s.startLine <= line) span = s;

    const local = line - span.startLine + 1;
    return span.index === spans.length - 1
      ? { kind: "input", line: local, column }
      : { kind: "history", cell: span.index, source: span.source, line: local };
  }
}

// =============================================================================================

function countLines(s: string): number {
  let n = 1;
  for (const c of s) if (c === "\n") n++;
  return n;
}

/** Mirrors JSTransformerAstVisitor.isStatement, which is private. */
function isStatement(node: any): boolean {
  const t = node?.type;
  return (
    typeof t === "string" &&
    (t.endsWith("Statement") || t.endsWith("Declaration") || t === "MethodDefinition")
  );
}

function expressionStatement(expression: any): ESTree.ExpressionStatement {
  return { type: "ExpressionStatement", expression };
}

/**
 * Make a top-level binding REDEFINABLE, and reachable as a property of the sandbox global.
 *
 * `class X {}` and `const X = ...` are LEXICAL: in a vm context they land in the realm's global
 * lexical environment, which means (a) a second script redeclaring them throws
 * `SyntaxError: Identifier 'X' has already been declared`, and (b) they are not readable as
 * `sandbox.X`. Redefinition is the entire point of a REPL, so every top-level lexical binding
 * becomes a `var`. `visitVariable` already does this under `noIIFE`; `visitClass` and `visitEnum`
 * do not, which is why a class could be defined in the REPL exactly once.
 */
function deLexicalize(s: any): ESTree.Statement {
  if (s.type === "ClassDeclaration" && s.id) {
    return {
      type: "VariableDeclaration",
      kind: "var",
      declarations: [
        {
          type: "VariableDeclarator",
          id: s.id,
          init: { ...s, type: "ClassExpression" },
        },
      ],
    } as ESTree.VariableDeclaration;
  }
  if (s.type === "VariableDeclaration" && s.kind !== "var") {
    return { ...s, kind: "var" };
  }
  return s;
}

/**
 * The value protocol.
 *
 * NOT the script's completion value. `var x = 5;` has an EMPTY completion, so a script's value
 * falls back to the last non-empty one -- which is why the old REPL could have reported
 * `=> "use strict"` had it not been accidentally severing the directive with its marker split. And
 * the old `return output.length > 0 ? undefined : value` hack threw away the value of any form that
 * both logged and returned.
 *
 * So: name the result explicitly. An expression assigns into it; a declaration reads the bound name
 * back out (taken from the EMITTED ESTree, so identifier mangling -- `my-fn` -> `my2dfn` -- is
 * handled for free). Nice side effect: `(let x 5)` can answer `=> 5` rather than `undefined`.
 */
function captureResult(body: ESTree.Statement[]): ESTree.Statement[] {
  const assign = (right: any): ESTree.Statement => ({
    type: "ExpressionStatement",
    expression: {
      type: "AssignmentExpression",
      operator: "=",
      left: { type: "Identifier", name: RESULT_VAR },
      right,
    },
  });

  const last: any = body[body.length - 1];
  if (!last) return [assign({ type: "Identifier", name: "undefined" })];

  if (last.type === "ExpressionStatement") {
    body.pop();
    return [assign(last.expression)];
  }

  const bound =
    last.type === "VariableDeclaration"
      ? last.declarations?.[0]?.id
      : last.type === "FunctionDeclaration" || last.type === "ClassDeclaration"
        ? last.id
        : undefined;

  return [assign(bound ?? { type: "Identifier", name: "undefined" })];
}

/**
 * The name(s) a declaration's `name` field binds.
 *
 * There are two shapes, and they are not interchangeable. `variable` and `function` name themselves
 * with an `IdentifierNode` -- whose field is `id: string`. `class`, `struct`, `enum` and `interface`
 * use a `TypeNameNode` -- whose field is `name: string`. Reading only one of them finds half the
 * declarations, silently.
 *
 * A `let` may also destructure (`(let [x y] point)`), in which case the target is a pattern binding
 * several names at once.
 */
function bindingNames(n: any): string[] {
  if (!n) return [];
  if (typeof n === "string") return [n];
  if (typeof n.id === "string") return [n.id]; // simple- / composite-identifier
  if (typeof n.name === "string") return [n.name]; // type-name
  if (Array.isArray(n.elements)) return n.elements.flatMap(bindingNames); // vector pattern
  if (Array.isArray(n.entries)) return n.entries.flatMap(bindingNames); // map pattern
  return [];
}

/**
 * Top-level names a cell binds. Drives `.delete`.
 *
 * Each cell arrives as a `list` WRAPPING its declaration -- and note that the wrapper also carries
 * the child's fields smeared onto it (TreeShakeAstVisitor spreads the child into the parent but
 * forces `_type` back to "list"), so the wrapper is not safe to read directly. Go through `nodes`.
 */
function declaredNames(nodes: ast.ASTNode[]): string[] {
  const names: string[] = [];

  const scan = (n: any): void => {
    if (!n || typeof n !== "object") return;

    if (DECLARING.has(n._type)) {
      names.push(...bindingNames(n.name));
      return;
    }
    if (n._type === "list" && Array.isArray(n.nodes)) n.nodes.forEach(scan);
  };

  nodes.forEach(scan);
  return names;
}

/** The type a name is currently bound at, as a comparable label. `undefined` when not yet known. */
function typeOf(ctx: Context, name: string): string | undefined {
  const entry = ctx.symbolTable?.getAllSymbols?.().get(name);
  const t = (entry as any)?.inferredType;
  if (!t) return undefined;
  if (typeof t === "string") return t;
  return typeof t.name === "string" ? t.name : undefined;
}

function severityOf(s: RuleSeverity): ReplSeverity {
  if (s === RuleSeverity.Error) return "error";
  if (s === RuleSeverity.Warning) return "warning";
  return "message";
}

/**
 * The human sentence, out of a message that only exposes itself fully rendered.
 *
 * `RuleValidationMessage.message` is a lazy getter that returns a chalk-coloured,
 * terminal-width-aware blob with a source excerpt and a trailing `at <path>:<line>:<col>`. The raw
 * `rule.message` is captured in a closure and never exposed. So: strip ANSI, take the sentence that
 * follows the inverse-rendered code. Fragile by construction -- the inbox note asks for a `text`
 * field on RuleValidationMessage precisely so this can be deleted.
 */
function sentenceOf(m: { code: string; message: string }): string {
  const plain = String(m.message).replace(/\[[0-9;]*m/g, "");
  const line = plain
    .split("\n")
    .map((l) => l.trim())
    .find((l) => l.includes(m.code));

  if (!line) return plain.split("\n").find((l) => l.trim()) ?? "";
  return line.slice(line.indexOf(m.code) + m.code.length).trim();
}

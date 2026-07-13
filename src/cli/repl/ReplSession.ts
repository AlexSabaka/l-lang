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

  getContext(): Context {
    return this.context;
  }

  eval(source: string): ReplResult {
    this.output = [];

    const spans = this.layout(source);
    const tailStart = spans[spans.length - 1].startOffset;
    const program = spans.map((s) => s.source).join("\n\n");

    fs.writeFileSync(this.file, program);

    const ctx = new Context(this.file, this.options);
    this.context = ctx;

    let root: ast.ProgramNode;
    try {
      root = ctx.process(this.file, "types").ast as ast.ProgramNode;
    } catch (e: any) {
      // The lexer and the parser THROW rather than reporting; everything after them reports.
      return { kind: "refused", diagnostics: [this.fromThrow(e, spans)], output: [] };
    }

    // B2: the thing the old REPL never did. `Context.processModule` deliberately does not log --
    // the CLI is meant to (see command.run.ts) -- and the REPL never read `results`, so a refusal
    // printed nothing at all and the prompt just came back.
    if (ctx.results.hasErrors) {
      return { kind: "refused", diagnostics: this.collect(ctx, spans), output: [] };
    }

    let emitted: { js: string; tail: ast.ASTNode[] };
    try {
      emitted = this.emitTail(ctx, root, tailStart);
    } catch (e: any) {
      return { kind: "refused", diagnostics: [this.fromThrow(e, spans)], output: [] };
    }

    let value: unknown;
    try {
      vm.runInContext(emitted.js, this.sandbox, { filename: "<repl>" });
      value = (this.sandbox as any)[RESULT_VAR];
    } catch (error: any) {
      // It compiled but blew up. History stays exactly as it was: replaying a form whose side
      // effects only half-happened would compile against a world that never existed.
      return { kind: "runtime-error", error, output: this.output };
    }

    this.cellList.push({
      index: this.cellList.length,
      source,
      declares: declaredNames(emitted.tail),
    });

    return {
      kind: "value",
      value,
      output: this.output,
      warnings: this.collect(ctx, spans).filter((d) => d.severity !== "error"),
    };
  }

  reset(): void {
    this.cellList = [];
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

#!/usr/bin/env ts-node
/**
 * The measurement harness for the REPL.
 *
 * WHY THIS EXISTS: the REPL is the only subsystem that never had a gate. While P4-P8 armed the type
 * checker, tightened the grammar and cut over to grammar_v2, nothing here was ever executed by a
 * test -- so it rotted invisibly, and is now dead on the first keystroke. Every other harness in
 * this directory drives `.lisp` files through `Context`; not one of them touches the REPL.
 *
 * It drives `ReplSession` and `MultiLineBuffer` DIRECTLY -- no pty, no readline, no stdout scraping.
 * That is only possible because those two are headless by contract: the session takes a string and
 * returns plain data, and all colour lives in the renderer. A REPL that can only be tested through a
 * terminal is a REPL that will not be tested.
 *
 * Discipline, same as test:codegen: a case must go RED before its fix lands. A case that passes on
 * the first run proves nothing about the bug it claims to cover.
 *
 * NOT IN SCOPE. `__`-prefixed identifiers do not tokenize under grammar_v2 (the `Underscore` token
 * omits `_` from its own lookahead, so `__private` lexes as wildcard + `_private`). That is a real
 * compiler bug -- it is why the old REPL, whose boundary marker was named `__repl_marker`, failed to
 * parse EVERY input -- but it is a compiler bug, and this refactor is scoped REPL-side. The REPL
 * routes around it by deleting the marker entirely. The lexer fix and its test belong to the
 * compiler stream; see docs/inbox/compiler-notes-from-repl.md. Do not add a `__private` case here.
 *
 * Usage:
 *   npm run test:repl
 *   npm run test:repl -- --verbose
 */
import { CompilerOptions, LogLevel } from "../compiler/Context";
import { ReplSession, ReplResult } from "../cli/repl/ReplSession";
import { MultiLineBuffer } from "../cli/repl/MultiLineBuffer";
import { ReplCompleter } from "../cli/repl/ReplCompleter";

const VERBOSE = process.argv.includes("--verbose");
const FRONTEND = (process.argv.find((a) => a.startsWith("--frontend="))?.split("=")[1] ??
  "grammar_v2") as any;

type Step =
  /** One submitted input, evaluated by the session. */
  | { input: string }
  /** Lines fed through the multi-line buffer; the completed form (if any) is then evaluated. */
  | { lines: string[] }
  | { reset: true }
  | { delete: string }
  /** `.type <expr>` -- must NOT enter history. */
  | { type: string }
  /** `.load <file>` -- path is relative to src/. */
  | { load: string }
  /** Tab-complete this line. */
  | { complete: string };

interface Expect {
  /** The value, rendered by `show()`. Structural -- never a chalk string. */
  value?: string;
  /**
   * The value must NOT be this. For assertions of the form "it must no longer be 1".
   *
   * A refusal or a runtime error SATISFIES this: a binding that is gone is certainly not still 1,
   * and after a real `.reset` a bare `x` is an unresolved name, not a value.
   */
  notValue?: string;
  /** The line the diagnostic must be attributed to, WITHIN the user's own input. */
  line?: number;
  /** console.log lines produced BY THIS STEP, in order. `[]` asserts silence. */
  output?: string[];
  /** The input must be REFUSED, reporting diagnostics matching all of these. */
  refused?: RegExp[];
  /** Where the diagnostic must be attributed. */
  origin?: "input" | "history" | "file";
  /** The emitted JavaScript must have thrown. */
  runtimeError?: RegExp;
  /** For `{lines}` steps: what the buffer must have decided. */
  buffer?: "complete" | "incomplete" | "unbalanced" | "empty";
  /** For `{delete}` steps: what the deletion must have taken with it. */
  deleted?: { broke?: number; alsoRemoved?: string[] };
  /** For `{type}` steps: the inferred type. */
  inferred?: string;
  /** For `{load}` steps: how many forms must have loaded cleanly. */
  loaded?: number;
  /** For `{complete}` steps: what must, and must not, be offered. */
  completions?: { has?: string[]; hasNot?: string[] };
  /** After an eval: what the emitted JavaScript must look like. */
  js?: RegExp[];
  /** After an eval: what `.symbols` must, and must not, report. */
  symbols?: { has?: string[]; hasNot?: string[] };
}

interface Case {
  name: string;
  steps: Step[];
  /** Positionally aligned with `steps`. `null` = don't care about that step. */
  expect: (Expect | null)[];
  /** History length at the end. Pins what does, and does not, enter history. */
  cells?: number;
  /** What was wrong before -- printed on failure, so a regression names its own bug. */
  wasBroken: string;
}

const CASES: Case[] = [
  // -----------------------------------------------------------------------------------------
  // B1 -- the REPL is dead on the first keystroke.
  // -----------------------------------------------------------------------------------------
  {
    name: "a binding evaluates, under the DEFAULT frontend",
    steps: [{ input: "(let x 5)" }, { input: "x" }],
    expect: [null, { value: "5" }],
    cells: 2,
    wasBroken:
      "the session injected a boundary marker named `__repl_marker`, and grammar_v2's Underscore " +
      "token ate its leading `_`. EVERY input failed to parse. The REPL only worked under --frontend peg.",
  },
  {
    name: "a literal is its own value",
    steps: [{ input: "42" }],
    expect: [{ value: "42" }],
    cells: 1,
    wasBroken: "same marker parse failure -- nothing evaluated at all.",
  },
  {
    name: "a binding reports its value, not the strict directive",
    steps: [{ input: "(let x 5)" }],
    expect: [{ value: "5" }],
    wasBroken:
      "`var x = 5;` has an EMPTY completion, so a script's value falls back to the last non-empty " +
      "one -- the `\"use strict\"` directive. Reading the vm completion value reports `=> \"use strict\"`.",
  },

  // -----------------------------------------------------------------------------------------
  // B5 -- history must be COMPILED, never re-EXECUTED.
  // -----------------------------------------------------------------------------------------
  {
    name: "history is not re-executed",
    steps: [{ input: '(console.log "once")' }, { input: "(let y 2)" }],
    expect: [{ output: ["once"] }, { output: [] }],
    cells: 2,
    wasBroken:
      "the new code was recovered by splitting the emitted JavaScript on a marker STRING. If the " +
      "split ever missed, `parts.pop()` handed back the whole program and all history re-ran. No guard.",
  },

  // -----------------------------------------------------------------------------------------
  // B2 -- the compiler's diagnostics must reach the prompt.
  // -----------------------------------------------------------------------------------------
  {
    name: "a refused form reports its diagnostic",
    steps: [{ input: "(defmacro m [x] x)" }],
    expect: [{ refused: [/LL0023/], origin: "input" }],
    cells: 0,
    wasBroken:
      "Context.processModule returns {ast} with no `code` on error and deliberately does not log -- " +
      "the CLI is meant to. command.repl.ts never read context.results, so a refusal printed NOTHING: " +
      "just a fresh prompt, no message, no reason.",
  },
  {
    name: "a refused form does not enter history",
    steps: [{ input: "(defmacro m [x] x)" }, { input: "(let ok 1)" }, { input: "ok" }],
    expect: [{ refused: [/LL0023/] }, null, { value: "1" }],
    cells: 2, // the defmacro is refused; `(let ok 1)` and `ok` are both accepted inputs
    wasBroken:
      "nothing enforced this. A form that failed to compile could still be replayed, so one bad " +
      "input poisoned every subsequent one until .reset.",
  },

  // -----------------------------------------------------------------------------------------
  // B3 -- a stray `)` must not kill the process.
  // -----------------------------------------------------------------------------------------
  {
    name: "a stray ) is refused, and does not crash",
    steps: [{ lines: [")"] }],
    expect: [{ buffer: "unbalanced" }],
    cells: 0,
    wasBroken:
      "checkBracketsBalance returns -1 for more closers than openers; command.repl.ts did " +
      "`\".\".repeat(balance * 2)` -> RangeError, thrown OUTSIDE the line handler's try/catch. " +
      "Typing `)` killed the REPL.",
  },

  // -----------------------------------------------------------------------------------------
  // B4 -- .reset must actually reset.
  // -----------------------------------------------------------------------------------------
  {
    name: ".reset clears the sandbox, not just the history",
    steps: [{ input: "(let x 1)" }, { reset: true }, { input: "x" }],
    expect: [null, null, { notValue: "1" }],
    cells: 0,
    wasBroken:
      "reset() cleared history and rebuilt the Context but REUSED the vm context, so every `var` the " +
      "user had ever defined survived it. `(let x 1)`, `.reset`, `x` still answered 1.",
  },

  // -----------------------------------------------------------------------------------------
  // Redefinition. D17.
  // -----------------------------------------------------------------------------------------
  {
    name: "rebinding at the same type is accepted",
    steps: [{ input: "(let x 1)" }, { input: "(let x 2)" }, { input: "x" }],
    expect: [null, null, { value: "2" }],
    cells: 3,
    wasBroken:
      "worked only BY ACCIDENT: LL0212 (duplicate declaration) is checked in visitList, not " +
      "visitProgram, and the REPL's cells are sibling top-level forms. This case PINS that. If " +
      "anyone moves LL0212 to visitProgram, or wraps the replayed program in the conventional outer " +
      "list the way every example and both new harnesses do, every rebind becomes a hard error.",
  },
  {
    name: "a type-changing rebind is refused, at the user's own line",
    steps: [
      { input: "(let x 1)" },
      { input: "(fn double [] -> Int (* x 2))" },
      { input: '(let x "hi")' },
      { input: "x" },
    ],
    expect: [null, null, { refused: [/REPL0001/], origin: "input", line: 1 }, { value: "1" }],
    cells: 3, // the rebind is refused; the other three inputs are accepted
    wasBroken:
      "D17, and NOT what the ruling first assumed. The checker treats a second `(let x ...)` as an " +
      "ASSIGNMENT to the existing symbol, so a binding's TYPE IS FIXED AT FIRST DECLARATION: the " +
      "rebind is refused (LL0200) whether or not anything depends on x. MEASURED: identical refusal " +
      "with and without `double` present. That makes .delete the ONLY way to change a binding's " +
      "type -- it is not a convenience, it is the escape hatch.\n" +
      "        `line: 1` pins the remapping: in the assembled program this error is on line 5. The " +
      "old REPL would have reported a line number in a temp file the user never saw.",
  },
  {
    name: ".delete is the only way to change a binding's type",
    steps: [
      { input: "(let x 1)" },
      { input: '(let x "hi")' },
      { delete: "x" },
      { input: '(let x "hi")' },
      { input: "x" },
    ],
    expect: [null, { refused: [/REPL0001/] }, null, null, { value: '"hi"' }],
    cells: 2,
    wasBroken:
      "there was no .delete, and without it a type-changing rebind WEDGES the session: the only way " +
      "out is .reset, which throws away everything. Note what this case is NOT -- deleting a " +
      "DEPENDENT (`double`) does not unblock the rebind, because the refusal never came from the " +
      "dependent. It came from `x` already being Int.",
  },
  {
    name: "a rebind cannot SILENTLY break a dependent",
    steps: [
      { input: "(let x 1)" },
      { input: "(fn double [] -> Int (* x 2))" },
      { input: "(double)" },
      { input: '(let x "hi")' },
      { input: "(double)" },
    ],
    expect: [null, null, { value: "2" }, { refused: [/REPL0001/] }, { value: "2" }],
    cells: 4,
    wasBroken:
      "THE silent wrong answer, and the reason the guard exists. A session's cells are sibling " +
      "top-level forms, so `(let x 1)` ... `(let x \"hi\")` puts TWO declarations of x at program " +
      "scope with different types -- while codegen emits ONE `var x`. The checker resolved `(* x 2)` " +
      "inside `double` against the FIRST x (Int) and said nothing; at run time double read the String " +
      "and returned null. A function declared `-> Int` returning null, with zero diagnostics.\n" +
      "        MEASURED: the compiler cannot catch this and should not be asked to. In a FILE the " +
      "shape is impossible (one top-level block, so a redeclaration is LL0212), and a forward " +
      "reference from a function body to a `let` declared LATER at program scope is not type-checked " +
      "either -- so dropping the earlier cell does not restore the check. LL0200 used to fire here by " +
      "accident (the checker read the second `let` as an assignment); P6 made resolution scope-aware " +
      "and that accident is gone. Hence REPL0001.",
  },
  {
    name: ".delete reports the cells it breaks",
    steps: [
      { input: "(let x 1)" },
      { input: "(fn double [] -> Int (* x 2))" },
      { delete: "x" },
    ],
    expect: [null, null, { deleted: { broke: 1 } }],
    cells: 0,
    wasBroken:
      "deleting a declaration that surviving cells depend on has to drop them, and dropping code the " +
      "user wrote must be LOUD. Silently keeping them would replay a program that no longer compiles; " +
      "silently discarding them would lose work with no trace.",
  },

  // -----------------------------------------------------------------------------------------
  // F2/F3 -- the codegen traps. These are the guards against the obvious-but-wrong implementation.
  // -----------------------------------------------------------------------------------------
  {
    name: "a class defined in an EARLIER cell is constructed with `new`",
    steps: [
      { input: "(defclass P (let :ctor n <- Int 1))" },
      { input: "(let p (P))" },
      { input: "p.n" },
    ],
    expect: [null, null, { value: "1" }],
    wasBroken:
      "F2, and the reason tail-only codegen is UNSOUND. The transformer accumulates `this.classes` " +
      "AS IT WALKS declarations, then reads it back to decide `new P(...)` vs `P(...)`. Run it over " +
      "only the new nodes and the accumulator is empty, so `(P)` compiles to `P()` -> " +
      "'TypeError: Class constructor P cannot be invoked without new'. VISIT ALL, EMIT SOME.",
  },
  {
    name: "a class is redefinable",
    steps: [
      { input: "(defclass P (let :ctor n <- Int 1))" },
      { input: "(defclass P (let :ctor n <- Int 2))" },
      { input: "(let p (P))" },
      { input: "p.n" },
    ],
    expect: [null, null, null, { value: "2" }],
    wasBroken:
      "F3. visitClass emits an ESTree ClassDeclaration, which in a vm.Context lands in the realm's " +
      "GLOBAL LEXICAL environment: redeclaring it is a hard SyntaxError, and it is not even readable " +
      "as a property of the global. Redefinition is the entire point of a REPL.",
  },

  // -----------------------------------------------------------------------------------------
  // Output, values, and the divergence between the REPL and `node`.
  // -----------------------------------------------------------------------------------------
  {
    name: "a form that logs AND returns keeps its value",
    steps: [{ input: '(fn g [] -> Int (console.log "side") 7)' }, { input: "(g)" }],
    expect: [null, { output: ["side"], value: "7" }],
    wasBroken:
      "`return consoleOutput.length > 0 ? undefined : returnValue` -- a hack that threw away the " +
      "value of ANY form which both logged and returned.",
  },
  {
    name: "console.log formats the way node does, and yields nothing",
    steps: [{ input: '(console.log "v" [1 2])' }],
    expect: [{ output: ["v [ 1, 2 ]"], value: "undefined" }],
    wasBroken:
      "two bugs. (1) the REPL's console did JSON.stringify(arg, null, 2), so the SAME program printed " +
      "differently in the REPL than under `node` -- the 'two spellings, two answers' class this repo " +
      "keeps killing. (2) the replacement was written as a bare arrow, so it returned Array.push's " +
      "value -- the new LENGTH -- and `(console.log \"hi\")` answered `=> 1`.",
  },

  // -----------------------------------------------------------------------------------------
  // Multi-line.
  // -----------------------------------------------------------------------------------------
  // -----------------------------------------------------------------------------------------
  // Phase 5. Inspection, loading, and a completer that reads the language instead of guessing.
  // -----------------------------------------------------------------------------------------
  {
    name: ".symbols lists what YOU defined -- not function parameters",
    steps: [{ input: "(fn add [a <- Int b <- Int] -> Int (+ a b))" }],
    expect: [{ symbols: { has: ["add"], hasNot: ["a", "b"] } }],
    wasBroken:
      "`.symbols` read symbolTable.getAllSymbols(), which holds EVERY symbol in the program -- so it " +
      "listed `a, b` from inside `(fn add [a b] ...)` as though you had defined them at the prompt. " +
      "Asking the cells what they declared is both correct and cheaper.",
  },
  {
    name: ".js shows the JavaScript a form compiles to",
    steps: [{ input: "(let x 5)" }],
    expect: [{ js: [/var x = 5/] }],
    wasBroken:
      "there was no way to see the emitted code. For a COMPILER's own REPL that is the highest-value " +
      "thing it can show you -- half the bugs in this refactor would have been obvious on sight.",
  },
  {
    name: ".type infers without running, and without entering history",
    steps: [
      { input: "(fn add [a <- Int b <- Int] -> Int (+ a b))" },
      { type: "(add 1 2)" },
    ],
    expect: [null, { inferred: "Int" }],
    cells: 1, // the probe must leave no trace
    wasBroken:
      "there was no .type. The probe binds the expression to a throwaway name and reads that name's " +
      "type back -- so it works for a bare identifier and an arbitrary expression alike. It must not " +
      "enter history, or a `.type` would silently grow the session.",
  },
  {
    name: ".load unwraps the conventional file wrapper",
    steps: [{ load: "test/fixtures/repl/wrapped.lisp" }, { input: "(+ a b)" }],
    expect: [{ loaded: 2 }, { value: "3" }],
    cells: 3,
    wasBroken:
      "a file is written wrapped in ONE outer list, and that outer list is a BLOCK (D17). Loaded as a " +
      "single cell, every binding in it would be block-scoped and invisible at the next prompt -- so " +
      "`.load` unwraps the wrapper into sibling cells, which is what a session IS. Two traps: the " +
      "wrapper's children include COMMENT nodes (so 'are they all lists?' must ignore them), and " +
      "`_location.end.offset` is INCLUSIVE, so slicing to `end` drops the closing paren and the form " +
      "no longer parses.",
  },
  {
    name: "completion is derived from the language, not a stale list",
    steps: [
      { complete: "(defm" },
      { complete: "(let :p" },
      { complete: "ma" },
    ],
    expect: [
      { completions: { has: ["defmodifier"] } },
      { completions: { has: [":private"], hasNot: [":then", ":else", ":cond"] } },
      { completions: { hasNot: ["map"] } },
    ],
    wasBroken:
      "four hand-maintained arrays, all drifted. It offered `:cond`/`:then`/`:else`/`:each`/`:from` " +
      "as MODIFIERS -- none of them are, and since D4 an unknown `:modifier` is a HARD ERROR, so the " +
      "completer was proposing forms that cannot compile. It never learned `defmodifier`. And it " +
      "offered `map`, `filter`, `reduce`, `fold` and `print` as builtins: MEASURED against " +
      "RuntimeProvider.SYMBOL_MAP, not one of them exists. Now: keywords from the lexer's token " +
      "table, modifiers from the D4 whitelist the checker enforces, builtins from the runtime shim.",
  },
  {
    name: "a multi-line form is one cell",
    steps: [
      { lines: ["(fn add [a <- Int b <- Int] -> Int", "  (+ a b))"] },
      { input: "(add 2 3)" },
    ],
    expect: [{ buffer: "complete" }, { value: "5" }],
    cells: 2,
    wasBroken: "the marker parse failure (B1) killed this like everything else.",
  },
];

// -------------------------------------------------------------------------------------------------

function show(v: unknown): string {
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "function") return `[Function ${(v as any).name || "anonymous"}]`;
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function options(): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Error,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    stage: "codegen",
    language: "js",
    frontend: FRONTEND,
  };
}

/** Every way a step can fall short, as a list of human sentences. Empty = the step passed. */
function checkStep(e: Expect, res: ReplResult | { buffer: string }, bufKind?: string): string[] {
  const bad: string[] = [];

  if (e.buffer) {
    if (bufKind !== e.buffer) bad.push(`buffer: expected ${e.buffer}, got ${bufKind ?? "(none)"}`);
    if (e.buffer !== "complete") return bad; // nothing was evaluated; the rest cannot apply
  }

  const r = res as ReplResult;
  if (!("kind" in r)) return bad;

  if (e.refused) {
    if (r.kind !== "refused") {
      bad.push(
        `expected REFUSED ${e.refused.join(", ")}, got ${r.kind}` +
          (r.kind === "value" ? ` (${show(r.value)}) -- it compiled SILENTLY` : "")
      );
    } else {
      const blob = r.diagnostics.map((d) => `${d.code}: ${d.text}`).join(" | ");
      for (const re of e.refused) {
        if (!re.test(blob)) bad.push(`expected diagnostic ${re}, got ${blob || "(none)"}`);
      }
      if (e.origin && !r.diagnostics.some((d) => d.origin.kind === e.origin)) {
        bad.push(
          `expected a diagnostic attributed to ${e.origin}, got ` +
            (r.diagnostics.map((d) => d.origin.kind).join(", ") || "(none)")
        );
      }
      if (e.line !== undefined) {
        const lines = r.diagnostics.map((d) => (d.origin as any).line);
        if (!lines.includes(e.line)) {
          bad.push(`expected the diagnostic on line ${e.line}, got ${lines.join(", ") || "(none)"}`);
        }
      }
    }
    return bad;
  }

  // "it must no longer be X" is satisfied by a refusal or a throw -- both mean it is not X.
  if (e.notValue !== undefined && (r.kind === "refused" || r.kind === "runtime-error")) {
    return bad;
  }

  if (e.runtimeError) {
    if (r.kind !== "runtime-error") bad.push(`expected a runtime error, got ${r.kind}`);
    else if (!e.runtimeError.test(String(r.error?.message)))
      bad.push(`expected ${e.runtimeError}, got ${r.error?.message}`);
    return bad;
  }

  if (r.kind === "refused") {
    bad.push(`REFUSED: ${r.diagnostics.map((d) => `${d.code} ${d.text}`).join(" | ") || "(no reason given)"}`);
    return bad;
  }
  if (r.kind === "runtime-error") {
    bad.push(`THREW: ${String(r.error?.message).split("\n")[0].slice(0, 96)}`);
    return bad;
  }

  if (e.value !== undefined && show(r.value) !== e.value)
    bad.push(`expected value ${e.value}, got ${show(r.value)}`);
  if (e.notValue !== undefined && show(r.value) === e.notValue)
    bad.push(`value must NOT be ${e.notValue}, and is`);
  if (e.output) {
    const got = r.output;
    const ok = got.length === e.output.length && got.every((l, i) => l === e.output![i]);
    if (!ok) bad.push(`expected output ${JSON.stringify(e.output)}, got ${JSON.stringify(got)}`);
  }

  return bad;
}

function run(c: Case): string[] {
  const session = new ReplSession(options());
  const buffer = new MultiLineBuffer();
  const bad: string[] = [];

  try {
    for (let i = 0; i < c.steps.length; i++) {
      const step = c.steps[i];
      const e = c.expect[i];

      let res: ReplResult | undefined;
      let bufKind: string | undefined;

      if ("reset" in step) {
        session.reset();
        continue;
      }

      if ("delete" in step) {
        const outcome = session.delete(step.delete);
        if (outcome.kind === "not-found") {
          bad.push(`step ${i + 1}: .delete ${step.delete} -- not found`);
          continue;
        }
        const want = e?.deleted;
        if (want?.broke !== undefined && outcome.broke.length !== want.broke) {
          bad.push(
            `step ${i + 1}: expected ${want.broke} broken cell(s), got ${outcome.broke.length} ` +
              JSON.stringify(outcome.broke)
          );
        }
        if (
          want?.alsoRemoved &&
          JSON.stringify(outcome.alsoRemoved) !== JSON.stringify(want.alsoRemoved)
        ) {
          bad.push(
            `step ${i + 1}: expected alsoRemoved ${JSON.stringify(want.alsoRemoved)}, ` +
              `got ${JSON.stringify(outcome.alsoRemoved)}`
          );
        }
        continue;
      }

      if ("type" in step) {
        const out = session.inferType(step.type);
        if (out.kind === "refused") {
          bad.push(`step ${i + 1}: .type ${step.type} refused: ` +
            out.diagnostics.map((d) => `${d.code} ${d.text}`).join("; "));
        } else if (e?.inferred !== undefined && out.type !== e.inferred) {
          bad.push(`step ${i + 1}: expected type ${e.inferred}, got ${out.type}`);
        }
        continue;
      }

      if ("load" in step) {
        const out = session.load(step.load);
        if (out.kind === "error") {
          bad.push(`step ${i + 1}: .load ${step.load} failed: ${out.message}`);
          continue;
        }
        const ok = out.results.filter((r) => r.result.kind === "value").length;
        if (e?.loaded !== undefined && ok !== e.loaded) {
          const why = out.results
            .filter((r) => r.result.kind !== "value")
            .map((r) => r.source.split("\n")[0])
            .join(" | ");
          bad.push(`step ${i + 1}: expected ${e.loaded} form(s) loaded, got ${ok}. failed: ${why || "(none)"}`);
        }
        continue;
      }

      if ("complete" in step) {
        const [hits] = new ReplCompleter(session).complete(step.complete);
        for (const want of e?.completions?.has ?? []) {
          if (!hits.includes(want)) bad.push(`step ${i + 1}: expected \`${want}\` offered, got: ${hits.slice(0, 8).join(", ") || "(none)"}`);
        }
        for (const nope of e?.completions?.hasNot ?? []) {
          if (hits.includes(nope)) bad.push(`step ${i + 1}: \`${nope}\` must NOT be offered, and was`);
        }
        continue;
      }

      if ("lines" in step) {
        let completed: string | undefined;
        for (const line of step.lines) {
          const fed = buffer.feed(line);
          bufKind = fed.kind;
          if (fed.kind === "complete") completed = fed.source;
        }
        if (completed !== undefined) res = session.eval(completed);
      } else {
        res = session.eval(step.input);
      }

      if (!e) continue;
      const problems = checkStep(e, res ?? ({ buffer: bufKind ?? "" } as any), bufKind);
      for (const p of problems) bad.push(`step ${i + 1}: ${p}`);

      for (const re of e.js ?? []) {
        if (!re.test(session.emittedJs)) {
          bad.push(`step ${i + 1}: emitted JS must match ${re}, got ${JSON.stringify(session.emittedJs)}`);
        }
      }
      if (e.symbols) {
        const names = [...session.symbols().keys()];
        for (const want of e.symbols.has ?? []) {
          if (!names.includes(want)) bad.push(`step ${i + 1}: .symbols must list '${want}', got ${names.join(", ") || "(none)"}`);
        }
        for (const nope of e.symbols.hasNot ?? []) {
          if (names.includes(nope)) bad.push(`step ${i + 1}: .symbols must NOT list '${nope}', and does`);
        }
      }
    }

    if (c.cells !== undefined && session.cells.length !== c.cells) {
      bad.push(`history: expected ${c.cells} cell(s), got ${session.cells.length}`);
    }
  } catch (err: any) {
    // A THROW that escapes the session is itself the bug -- B3 is exactly this.
    bad.push(`UNCAUGHT ${err?.name ?? "Error"}: ${String(err?.message).split("\n")[0].slice(0, 88)}`);
  } finally {
    session.dispose();
  }

  return bad;
}

function main() {
  console.log(`=== repl: the session is driven directly -- no pty, no readline ===`);
  console.log(`    frontend: ${FRONTEND}\n`);

  let failed = 0;
  for (const c of CASES) {
    const problems = run(c);
    if (problems.length === 0) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.name}`);
      for (const p of problems) console.log(`          ${p}`);
      if (VERBOSE) console.log(`          was: ${c.wasBroken}`);
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  cases : ${CASES.length}`);
  console.log(`  failed: ${failed}   (target: 0)`);

  process.exit(failed === 0 ? 0 : 1);
}

main();

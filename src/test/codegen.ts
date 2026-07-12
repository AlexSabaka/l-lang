#!/usr/bin/env ts-node
/**
 * The measurement harness for P5 -- the code generator emits wrong JavaScript.
 *
 * WHY THIS EXISTS, when `test:type-errors` and the golden runner already do:
 *
 * The backend has an acorn re-parse guard (LL0101), and it is worth having -- but **acorn validates
 * SYNTAX, not BEHAVIOUR**. The bug class that actually matters here is *valid JavaScript that does
 * the wrong thing*, and LL0101 cannot see it, by construction:
 *
 *     switch (true) { case cond: ...; break; case _else: ...; break; }
 *
 * is syntactically impeccable and throws `ReferenceError: _else is not defined` the moment the
 * `else` branch is reached. The compiler reports nothing. It survived only because no example in the
 * corpus happens to use `(else ...)`.
 *
 * So: every case here COMPILES a small program, EXECUTES the emitted JavaScript, and asserts its
 * stdout. Nothing else in the tree does that on a program small enough to isolate one defect.
 *
 * Discipline: a case must go RED before its fix lands. A case that passes on the first run proves
 * nothing about the bug it claims to cover.
 *
 * Usage:
 *   npm run test:codegen
 *   npm run test:codegen -- --verbose   # also print the emitted JS for every failure
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";

const VERBOSE = process.argv.includes("--verbose");
const FRONTEND = (process.argv.find((a) => a.startsWith("--frontend="))?.split("=")[1] ??
  "grammar_v2") as any;
const RUN_TIMEOUT_MS = 10_000;

interface Case {
  name: string;
  /** The program body. Wrapped in the conventional top-level list. */
  source: string;
  /** Exact expected stdout lines, in order. */
  expect: string[];
  /** What was wrong before P5 -- printed on failure, so a regression names its own bug. */
  wasBroken: string;
}

const CASES: Case[] = [
  // ---------------------------------------------------------------------------------------------
  // Silent wrong answers. Valid JavaScript; wrong behaviour. LL0101 is blind to every one of these.
  // ---------------------------------------------------------------------------------------------
  {
    name: ":ctor defaults are emitted",
    source: `(defclass Vec (let :ctor x <- Int 7) (let :ctor y <- Int 9))
(let v (Vec))
(console.log v.x v.y)`,
    expect: ["7 9"],
    wasBroken: "emitted `constructor(x, y)` -- the default was dropped, so (Vec) gave undefined",
  },
  {
    name: ":ctor defaults do not clobber an explicit argument",
    source: `(defclass Vec (let :ctor x <- Int 7))
(let a (Vec 1))
(let b (Vec))
(console.log a.x b.x)`,
    expect: ["1 7"],
    wasBroken: "a default that overrides its argument is the obvious way to get this wrong",
  },
  {
    name: "a ctor default inherited through :extends",
    source: `(defclass Base (let :ctor n <- Int 5))
(defclass Derived :extends Base)
(let d (Derived))
(console.log d.n)`,
    expect: ["5"],
    wasBroken: "parent ctor params were passed through as a bare string[], losing the default too",
  },
  {
    name: "cond: the else branch runs",
    source: `(let n -5)
(cond ((> n 0) (console.log "pos"))
      (else    (console.log "else")))`,
    expect: ["else"],
    wasBroken: "emitted `case _else:` -- an UNDEFINED identifier. ReferenceError, zero diagnostics",
  },
  {
    name: "cond: a non-else branch still wins",
    source: `(let n 5)
(cond ((> n 0) (console.log "pos"))
      (else    (console.log "else")))`,
    expect: ["pos"],
    wasBroken: "guards the else fix -- `default:` must not swallow a matching case",
  },
  {
    name: "when: a multi-expression body yields its LAST value",
    source: `(let v (when true :then "first" "second"))
(console.log v)`,
    expect: ["second"],
    // NOT a bug, and this case is why the harness gets written BEFORE the fix. P5's plan claimed the
    // emitted comma operator -- `("first", "second")` -- "discards the earlier values". It does not:
    // `(a, b)` evaluates `a`, then `b`, and yields `b`. That IS last-value semantics with every side
    // effect intact. The case passed on the first run, which falsified the claim.
    //
    // Kept as a GUARD: the fix to `when` rewrites this code path, and the property must survive it.
    wasBroken: "not broken -- a guard on the property the visitWhen rewrite must preserve",
  },
  {
    name: "when: a false condition yields nothing",
    source: `(let v (when false :then "x"))
(console.log v)`,
    expect: ["undefined"],
    wasBroken: "`when` has no else (WhenNode {condition, then[]}); a false condition is undefined",
  },
  {
    name: "map keys are never mangled (D13)",
    source: `(let m { :my-key 1 :other-key 2 })
(console.log (JSON.stringify m))`,
    expect: ['{"my-key":1,"other-key":2}'],
    wasBroken: "visitKeyValue ran keys through encodeIdentifier, so `:my-key` emitted `my2dkey`",
  },

  // ---------------------------------------------------------------------------------------------
  // Invalid JavaScript. These DO trip LL0101 -- but the harness runs them, so it proves the emitted
  // code not only parses but behaves.
  // ---------------------------------------------------------------------------------------------
  {
    name: "when: a multi-statement body in STATEMENT position",
    source: `(mut counter 0)
(when (> counter -1) :then (
  (console.log "ran")
  (counter := (+ counter 10))
))
(console.log counter)`,
    expect: ["ran", "10"],
    wasBroken: "emitted `cond ? { stmt; stmt; } : undefined` -- a BlockStatement in an expression slot",
  },
  {
    name: "when: a multi-statement body used for its VALUE",
    source: `(let v (when true :then (
  (console.log "side effect")
  "value"
)))
(console.log v)`,
    expect: ["side effect", "value"],
    wasBroken: "the value of a multi-statement body needs an IIFE, as visitMatch already does",
  },

  // ---------------------------------------------------------------------------------------------
  // Missing emitters.
  // ---------------------------------------------------------------------------------------------
  {
    name: "await is emitted",
    source: `(fn :async fetch-it [id] (return (+ "Data_" id)))
(fn :async main-task [] (
  (let data (await (fetch-it 42)))
  (console.log data)
))
(main-task)`,
    expect: ["Data_42"],
    wasBroken: "LL0100: visitAwait did not exist. `async` was fully wired; the gap was one node type",
  },
];

// -------------------------------------------------------------------------------------------------

interface Outcome {
  ok: boolean;
  detail: string;
  js?: string;
}

function run(c: Case, tmp: string): Outcome {
  const lispPath = path.join(tmp, `${c.name.replace(/[^a-z0-9]+/gi, "_")}.lisp`);
  const jsPath = lispPath.replace(/\.lisp$/, ".js");
  fs.writeFileSync(lispPath, `(\n${c.source}\n)\n`);

  const options: CompilerOptions = {
    minimumLogLevel: LogLevel.Warning,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    stage: "codegen",
    language: "js",
    frontend: FRONTEND,
  };

  let code: string;
  try {
    const context = new Context(lispPath, options);
    const result: any = context.process(lispPath);

    // A reported error blocks emission -- report it as the failure, with its code, so an LL0100 or
    // LL0101 names itself rather than surfacing as a mystery.
    if (context.results.hasErrors) {
      const codes = context.results.all
        .filter((m: any) => String(m.code).startsWith("LL"))
        .map((m: any) => `${m.code}: ${String(m.message).split("\n").pop()!.trim().slice(0, 88)}`);
      return { ok: false, detail: `compile reported: ${codes.join(" | ") || "(errors)"}` };
    }
    code = result?.code ?? "";
  } catch (e: any) {
    return { ok: false, detail: `compile threw: ${String(e.message).split("\n")[0].slice(0, 96)}` };
  }

  fs.writeFileSync(jsPath, code);

  const proc = spawnSync("node", [jsPath], { encoding: "utf-8", timeout: RUN_TIMEOUT_MS });
  if (proc.error) {
    return { ok: false, detail: `node failed: ${(proc.error as any).code}`, js: code };
  }
  if (proc.status !== 0) {
    // THE case this harness exists for: the JS parsed, ran, and blew up.
    const stderr = String(proc.stderr).trim().split("\n").filter(Boolean);
    const blame = stderr.find((l) => /Error/.test(l)) ?? stderr[0] ?? "(no stderr)";
    return { ok: false, detail: `RUNTIME ERROR: ${blame.trim().slice(0, 96)}`, js: code };
  }

  const actual = String(proc.stdout).trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const expected = c.expect;
  const ok =
    actual.length === expected.length && actual.every((l, i) => l === expected[i]);

  return {
    ok,
    detail: ok ? "" : `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    js: code,
  };
}

function main() {
  const tmp = path.join(os.tmpdir(), "llang-codegen-cases");
  fs.mkdirSync(tmp, { recursive: true });

  console.log(`=== codegen: emitted JavaScript is RUN, and its output asserted ===`);
  console.log(`    frontend: ${FRONTEND}\n`);

  let failed = 0;
  for (const c of CASES) {
    const outcome = run(c, tmp);
    if (outcome.ok) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.name}`);
      console.log(`          ${outcome.detail}`);
      console.log(`          was: ${c.wasBroken}`);
      if (VERBOSE && outcome.js) {
        const body = outcome.js.split("\n").slice(-40).join("\n");
        console.log(`        --- emitted (tail) ---\n${body}\n        ----------------------`);
      }
    }
  }

  console.log(`\n=== summary ===`);
  console.log(`  cases : ${CASES.length}`);
  console.log(`  failed: ${failed}   (target: 0)`);

  process.exit(failed === 0 ? 0 : 1);
}

main();

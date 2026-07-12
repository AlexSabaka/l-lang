#!/usr/bin/env ts-node
/**
 * The module-system suite: P6's gate.
 *
 * Each case here is a bug that exists today, or a behaviour we have ruled on and must not
 * regress. They are written BEFORE the fix, so the phase is falsifiable rather than vibes --
 * the same discipline as test/type-errors.ts.
 *
 * The fixtures are written to a temp dir, not into examples/, because they are compiler tests
 * rather than language demonstrations, and several of them are expected to FAIL to compile.
 *
 * Usage:
 *   npm run test:imports
 *   npm run test:imports -- --verbose    # show emitted JS / full errors on failure
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";

const VERBOSE = process.argv.includes("--verbose");
const TMP = path.join(os.tmpdir(), "llang-import-tests");

interface Outcome {
  compiled: boolean;
  /** Diagnostics raised by the compiler (results.add entries). */
  diagnostics: string[];
  /** A thrown exception -- a crash, not a diagnosis. */
  crash?: string;
  /** stdout from running the emitted JS. */
  stdout?: string;
  /** stderr / runtime failure from running the emitted JS. */
  runtimeError?: string;
  code?: string;
}

function options(): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Error,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    stage: "codegen",
    language: "js",
    frontend: "grammar_v2",
  };
}

/** Compile `entry` and, if it compiled, run it. Never throws -- a crash is an outcome. */
function build(entry: string): Outcome {
  const context = new Context(entry, options());

  let result: any;
  try {
    result = context.process(entry);
  } catch (e: any) {
    return {
      compiled: false,
      diagnostics: [],
      crash: String(e?.message ?? e).split("\n")[0].slice(0, 120),
    };
  }

  const diagnostics = context.results.all.map(
    (m) => `${m.code} ${String(m.message).split("\n").pop()!.trim()}`
  );

  if (context.results.hasErrors || !result?.code) {
    return { compiled: false, diagnostics };
  }

  const js = entry.replace(/\.lisp$/, ".js");
  fs.writeFileSync(js, result.code);

  const run = spawnSync("node", [js], { encoding: "utf-8", timeout: 10_000 });
  return {
    compiled: true,
    diagnostics,
    code: result.code,
    stdout: (run.stdout ?? "").trim(),
    runtimeError: run.status !== 0 ? (run.stderr ?? "").trim().split("\n").slice(0, 2).join(" ") : undefined,
  };
}

/** Write a set of files into a fresh case directory and return the entry path. */
function fixture(name: string, files: Record<string, string>, entry: string): string {
  const dir = path.join(TMP, name);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  for (const [file, source] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, file), source);
  }
  return path.join(dir, entry);
}

interface Case {
  name: string;
  why: string;
  run: () => { ok: boolean; detail: string };
}

const CASES: Case[] = [
  {
    name: "local binding is not hijacked by an imported symbol of the same name",
    why:
      "resolveSymbol cannot see nested scopes, so codegen keeps a shadow symbol table " +
      "(localIdentifiersStack) that registers ONLY parameters. A local `let` of the same name as " +
      "an imported symbol is therefore rewritten to the import's inlined JS name, collapsing two " +
      "different symbols into one. Today this dies with `Cannot access '__ll_inlined_counter_1' " +
      "before initialization`.",
    run: () => {
      const entry = fixture(
        "shadow",
        {
          "lib.lisp": `(\n  (let counter 999)\n  (export counter)\n)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  (console.log counter)   ;; the IMPORTED one -> 999\n` +
            `  (let counter 1)         ;; a LOCAL of the same name\n` +
            `  (console.log counter)   ;; -> 1\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      const ok = out.compiled && !out.runtimeError && out.stdout === "999\n1";
      return {
        ok,
        detail: out.runtimeError
          ? `runtime: ${out.runtimeError}`
          : `expected "999\\n1", got ${JSON.stringify(out.stdout ?? "<did not compile>")}`,
      };
    },
  },

  {
    name: "import cycle is a diagnostic, not a stack overflow",
    why:
      "Context.process recurses into imports during the symbols stage, but cacheModule -- the only " +
      "re-entry guard -- runs AFTER that stage. So A -> B -> A recurses forever: today this is " +
      "`RangeError: Maximum call stack size exceeded`.",
    run: () => {
      const entry = fixture(
        "cycle",
        {
          "a.lisp": `(\n  (import "b.lisp")\n  (fn fa [] -> Int 1)\n  (export fa)\n)\n`,
          "b.lisp": `(\n  (import "a.lisp")\n  (fn fb [] -> Int 2)\n  (export fb)\n)\n`,
        },
        "a.lisp"
      );
      const out = build(entry);

      const overflowed = /call stack|RangeError/i.test(out.crash ?? "");
      const diagnosed = out.diagnostics.some((d) => /cycl|circular/i.test(d));

      // Either a clean diagnostic, or it compiles (a cycle is not inherently fatal) -- but never
      // a stack overflow.
      return {
        ok: !overflowed && (diagnosed || out.compiled),
        detail: overflowed
          ? `stack overflow: ${out.crash}`
          : out.compiled
            ? "compiled without diagnosing the cycle"
            : `did not compile: ${out.diagnostics.join(" | ") || out.crash}`,
      };
    },
  },

  {
    name: "diamond import emits the shared module exactly once",
    why:
      "A -> B, A -> C, B -> D, C -> D. D's definitions must appear once in the output, not twice " +
      "(a duplicate `const` in the same scope is not valid JavaScript).",
    run: () => {
      const entry = fixture(
        "diamond",
        {
          "d.lisp": `(\n  (fn d-val [] -> Int (return 7))\n  (export d-val)\n)\n`,
          "b.lisp": `(\n  (import "d.lisp")\n  (fn b-val [] -> Int (return (d-val)))\n  (export b-val)\n)\n`,
          "c.lisp": `(\n  (import "d.lisp")\n  (fn c-val [] -> Int (return (d-val)))\n  (export c-val)\n)\n`,
          "main.lisp":
            `(\n  (import "b.lisp")\n  (import "c.lisp")\n  (console.log (+ (b-val) (c-val)))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      const ok = out.compiled && !out.runtimeError && out.stdout === "14";
      return {
        ok,
        detail: out.runtimeError
          ? `runtime: ${out.runtimeError}`
          : `expected "14", got ${JSON.stringify(out.stdout ?? "<did not compile>")}` +
            (out.diagnostics.length ? ` [${out.diagnostics.join(" | ")}]` : ""),
      };
    },
  },

  {
    name: "an imported module's top-level statements do NOT run",
    why:
      "The module-init ruling (audit 6.8): an import brings in DEFINITIONS, not execution. This is " +
      "today's behaviour, but today it is an accident of the clone-on-reference inliner -- the " +
      "bundler must preserve it deliberately. examples/06-import/01_lib_a.lisp relies on this.",
    run: () => {
      const entry = fixture(
        "sideeffect",
        {
          "lib.lisp":
            `(\n  (console.log "LIB BODY RAN")   ;; must NOT appear\n` +
            `  (fn helper [] -> Int (return 5))\n  (export helper)\n)\n`,
          "main.lisp": `(\n  (import "lib.lisp")\n  (console.log (helper))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      const ok = out.compiled && !out.runtimeError && out.stdout === "5";
      return {
        ok,
        detail: out.runtimeError
          ? `runtime: ${out.runtimeError}`
          : out.stdout?.includes("LIB BODY RAN")
            ? `the library body RAN -- got ${JSON.stringify(out.stdout)}`
            : `expected "5", got ${JSON.stringify(out.stdout ?? "<did not compile>")}`,
      };
    },
  },

  {
    name: "the dependency graph is keyed by paths that exist",
    why:
      "DependencyGraph.add re-resolves an already-absolute path with path.join, which (unlike " +
      "path.resolve) does not treat an absolute second argument as a reset. Every non-root node " +
      "is keyed by a path like `/…/06-import/Volumes/2TB/repos/…`, which does not exist.",
    run: () => {
      const entry = fixture(
        "graph",
        {
          "lib.lisp": `(\n  (fn f [] -> Int (return 1))\n  (export f)\n)\n`,
          "main.lisp": `(\n  (import "lib.lisp")\n  (console.log (f))\n)\n`,
        },
        "main.lisp"
      );

      const context = new Context(entry, { ...options(), stage: "symbols" });
      try {
        context.process(entry);
      } catch {
        /* the graph is what we are inspecting, not the compile */
      }

      // An ImportUnit's path lives at `location.fullName` -- not `name`.
      const bad: string[] = [];
      const seen = new Set<any>();
      const walk = (unit: any): void => {
        if (!unit || seen.has(unit)) return;
        seen.add(unit);
        const full = unit.location?.fullName;
        if (full && !fs.existsSync(full)) bad.push(full);
        (unit.dependencies ?? []).forEach(walk);
      };
      walk((context.dependencyGraph as any).rootUnit);

      return {
        ok: bad.length === 0,
        detail: bad.length ? `graph nodes with non-existent paths: ${bad[0]}` : "all node paths exist",
      };
    },
  },
];

function main() {
  fs.mkdirSync(TMP, { recursive: true });

  let failed = 0;
  console.log("=== module system ===\n");

  for (const c of CASES) {
    let ok = false;
    let detail = "";
    try {
      ({ ok, detail } = c.run());
    } catch (e: any) {
      detail = `harness threw: ${String(e?.message ?? e).split("\n")[0]}`;
    }

    if (ok) {
      console.log(`  PASS  ${c.name}`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.name}`);
      console.log(`          ${detail}`);
      if (VERBOSE) console.log(`          why: ${c.why}`);
    }
  }

  console.log(`\n${CASES.length - failed}/${CASES.length} passed`);
  process.exit(failed === 0 ? 0 : 1);
}

main();

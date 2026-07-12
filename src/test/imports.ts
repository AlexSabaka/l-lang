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
    name: "a nested local is not renamed to an imported symbol's inlined name",
    why:
      "resolveSymbol cannot see nested scopes, so codegen keeps a SHADOW symbol table " +
      "(localIdentifiersStack) that registers ONLY parameters -- not a `let` in a body. Such a " +
      "local, sharing a name with an imported symbol, is rewritten to the IMPORT's inlined JS " +
      "name: two different symbols collapsed into one. JS block-shadowing usually hides the " +
      "damage, which is why this survived -- so the test asserts the NAME, not just the output. " +
      "A local must keep its own name.",
    run: () => {
      const entry = fixture(
        "shadow",
        {
          "lib.lisp": `(\n  (let counter 999)\n  (export counter)\n)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  (fn compute [] -> Int (\n` +
            `      (let counter 1)      ;; a LOCAL, in a nested scope\n` +
            `      (return counter)     ;; -> 1, and must NOT be the import\n` +
            `  ))\n` +
            `  (console.log (compute))  ;; 1\n` +
            `  (console.log counter)    ;; the IMPORT -> 999\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);

      if (!out.compiled || out.runtimeError) {
        return {
          ok: false,
          detail: out.runtimeError ? `runtime: ${out.runtimeError}` : "did not compile",
        };
      }

      if (out.stdout !== "1\n999") {
        return { ok: false, detail: `expected "1\\n999", got ${JSON.stringify(out.stdout)}` };
      }

      // The real assertion: the LOCAL must keep its own name. Output alone does not catch this --
      // JS block-shadowing rescues the semantics even when the two symbols are conflated into one
      // name, which is exactly why the bug survived so long.
      const code = out.code ?? "";
      const localKeepsItsName = /\bconst counter = 1\b/.test(code);
      const importIsInlined = /__ll_inlined_counter\w* = 999/.test(code);

      return {
        ok: localKeepsItsName && importIsInlined,
        detail: !localKeepsItsName
          ? "the local `counter` did not keep its name -- it was emitted as the import's inlined name"
          : !importIsInlined
            ? "the imported `counter` was not inlined"
            : "local keeps its own name; the import is inlined separately",
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
    name: "inlined definitions are emitted in dependency order",
    why:
      "`inlinedDefinitions` is a Record, so Object.values() hands them back in DISCOVERY order -- " +
      "the order visitIdentifier happened to meet them. A definition can therefore be emitted " +
      "BEFORE the class it depends on: `const r = new __ll_inlined_Vec_1()` above " +
      "`const __ll_inlined_Vec_1 = class Vec {...}` is a temporal-dead-zone ReferenceError. " +
      "DependencyGraph.iterate() computes the right order and is never called from anywhere.",
    run: () => {
      const entry = fixture(
        "order",
        {
          // In SOURCE order the class comes first, then the top-level binding that uses it --
          // which is why the library compiles standalone. Emission must preserve that.
          "lib.lisp":
            `(\n` +
            `  (defclass Vec (let :ctor x <- Int 0))\n` +
            `  (let origin (new Vec 7))   ;; explicit arg: :ctor DEFAULTS are dropped by codegen (a\n` +
            `                             ;; separate P5 bug -- do not conflate it with ordering)\n` +
            `  (fn origin-x [] -> Int (return origin.x))\n` +
            `  (export origin-x)\n` +
            `)\n`,
          // main touches `origin-x` first; visiting its body then discovers `origin`, and only
          // then `Vec`. Emitted in discovery order that is `const origin = new Vec()` ABOVE
          // `const Vec = class ...` -- a temporal-dead-zone ReferenceError.
          "main.lisp": `(\n  (import "lib.lisp")\n  (console.log (origin-x))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      const ok = out.compiled && !out.runtimeError && out.stdout === "7";
      return {
        ok,
        detail: out.runtimeError
          ? `runtime: ${out.runtimeError}`
          : `expected "7", got ${JSON.stringify(out.stdout ?? "<did not compile>")}` +
            (out.diagnostics.length ? ` [${out.diagnostics.join(" | ")}]` : ""),
      };
    },
  },

  {
    name: "a deep cross-module chain emits in dependency order",
    why:
      "main -> f -> g -> h -> a top-level const -> a class, all in another module, with `f` " +
      "written FIRST in the library. Emission must still put the class before the const before h " +
      "before g before f. This pins down the post-order insertion invariant in ensureSymbolInlined.",
    run: () => {
      const entry = fixture(
        "chain",
        {
          "lib.lisp":
            `(\n` +
            `  (fn f [] -> Int (return (g)))     ;; written first, depends on g\n` +
            `  (fn g [] -> Int (return (h)))\n` +
            `  (fn h [] -> Int (return base.v))  ;; depends on a const...\n` +
            `  (defclass Holder (let :ctor v <- Int 0))\n` +
            `  (let base (new Holder 42))        ;; ...which depends on a class\n` +
            `  (export f)\n` +
            `)\n`,
          "main.lisp": `(\n  (import "lib.lisp")\n  (console.log (f))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      if (!out.compiled || out.runtimeError) {
        return { ok: false, detail: out.runtimeError ? `runtime: ${out.runtimeError}` : "did not compile" };
      }
      if (out.stdout !== "42") {
        return { ok: false, detail: `expected "42", got ${JSON.stringify(out.stdout)}` };
      }

      // And assert the ORDER, not just that it runs -- function declarations hoist, so a wrong
      // order can still work by accident for some shapes.
      const code = out.code ?? "";
      const at = (re: RegExp) => code.search(re);
      const holder = at(/class __ll_inlined_Holder/);
      const base = at(/const __ll_inlined_base/);
      const h = at(/const __ll_inlined_h_/);
      const ordered = holder >= 0 && base > holder && h > base;

      return {
        ok: ordered,
        detail: ordered
          ? "class -> const -> function, deepest dependency first"
          : `wrong order: Holder@${holder} base@${base} h@${h}`,
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

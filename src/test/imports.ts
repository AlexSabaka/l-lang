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
import { CHILD_ENV } from "./childEnv";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";
import { ModuleResolver } from "../compiler/analysis/ModuleResolver";
import { PackageRegistry } from "../compiler/analysis/PackageRegistry";

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

  const run = spawnSync("node", [js], { encoding: "utf-8", timeout: 10_000, env: CHILD_ENV });
  return {
    compiled: true,
    diagnostics,
    code: result.code,
    stdout: (run.stdout ?? "").trim(),
    runtimeError: run.status !== 0 ? (run.stderr ?? "").trim().split("\n").slice(0, 2).join(" ") : undefined,
  };
}

/**
 * The same, through the C backend: compile, `cc`, run.
 *
 * Most of this suite is JS-only because the module system is a frontend concern and the two backends
 * share it. A finding that lands in BOTH pipelines needs both graded, though -- N11's imported
 * `defenum` is a `ReferenceError` on JS and an `undeclared identifier` on C, and the fixes are in
 * different files, so a JS-only guard would leave half of it unprotected.
 */
function buildC(entry: string): Outcome {
  const context = new Context(entry, { ...options(), language: "c" } as CompilerOptions);

  let result: any;
  try {
    result = context.process(entry);
  } catch (e: any) {
    return { compiled: false, diagnostics: [], crash: String(e?.message ?? e).split("\n")[0].slice(0, 120) };
  }

  const diagnostics = context.results.all.map(
    (m) => `${m.code} ${String(m.message).split("\n").pop()!.trim()}`
  );
  if (context.results.hasErrors || !result?.code) return { compiled: false, diagnostics };

  const cPath = entry.replace(/\.lisp$/, ".c");
  const binPath = entry.replace(/\.lisp$/, ".bin");
  fs.writeFileSync(cPath, result.code);

  const cc = spawnSync("cc", ["-std=c11", "-fwrapv", cPath, "-o", binPath, "-lm"], {
    encoding: "utf-8",
    timeout: 60_000,
  });
  if (cc.status !== 0) {
    return {
      compiled: false,
      diagnostics,
      runtimeError: `cc: ${String(cc.stderr).split("\n").find((l) => /error:/.test(l)) ?? "failed"}`.slice(0, 160),
    };
  }

  const run = spawnSync(binPath, [], { encoding: "utf-8", timeout: 10_000 });
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
      // `1n`: D51 makes an Int a BigInt, so an Int literal emits with the suffix and `\b1\b`
      // cannot match it (`n` is a word character). The assertion is about the NAME, not the
      // literal, so it just has to tolerate the representation.
      const localKeepsItsName = /\bconst counter = 1n?\b/.test(code);
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

  // -----------------------------------------------------------------------------------------------
  // OPERATOR OVERLOADS ACROSS A MODULE BOUNDARY.
  //
  // `visitIdentifier` checks IMPORT before RUNTIME and RETURNS, so an imported `+` is inlined like any
  // ordinary function. Nothing in the corpus imports a top-level operator, which is exactly why this
  // has never been caught -- std/math declares its operators as one-param METHODS, so there is no
  // module-scope symbol named `+` in it at all.
  // -----------------------------------------------------------------------------------------------
  {
    name: "an imported top-level operator overload is CALLED, not inlined into itself",
    why:
      "The import check runs before the runtime check and returns, so `+` at the call site resolves " +
      "to the IMPORTED SYMBOL and gets inlined. Then, re-visiting the operator's own body, " +
      "`(+ a.amount b.amount)` -- adding two Ints -- hits the same memo key and compiles to a call to " +
      "THE FUNCTION CURRENTLY BEING DEFINED. It crashes: TypeError: Cannot read properties of " +
      "undefined (reading 'amount'). Two silent consequences too: `+` never reaches " +
      "inlineStandardSymbols, so the `+` SHIM IS NEVER EMITTED; and the registration block is reached " +
      "with the CALL SITE's scope depth, so __ll_op_registry.register is never emitted either.",
    run: () => {
      const entry = fixture(
        "imported-operator",
        {
          "lib.lisp":
            `(\n` +
            `  (defstruct Money (let :ctor amount <- Int 0))\n` +
            `  (fn :operator + [a <- Money b <- Money] -> Money\n` +
            `      (return (Money (+ a.amount b.amount))))\n` +
            `  (export Money)\n` +
            `)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  (let total (+ (Money 3) (Money 4)))\n` +
            `  (console.log total.amount)\n` +
            `  (console.log (+ 1 2))          ;; plain Ints must still add\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);

      if (!out.compiled) return { ok: false, detail: "did not compile" };
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };
      if (out.stdout !== "7\n3") {
        return { ok: false, detail: `expected "7\\n3", got ${JSON.stringify(out.stdout)}` };
      }

      // Output alone is not enough. Assert the SHAPE: the operator must be reached through the shim's
      // registry, and the operator's own body must NOT call itself.
      const code = out.code ?? "";
      const registered = /__ll_op_registry\.register\(\s*["']\+["']/.test(code);
      if (!registered) {
        return { ok: false, detail: "the imported operator was never registered with __ll_op_registry" };
      }

      return { ok: true, detail: "the imported operator is registered and dispatched, not self-inlined" };
    },
  },

  {
    name: "an imported ONE-PARAM METHOD operator still works (guard)",
    why:
      "Not broken -- a GUARD, and the shape of the only passing golden that exercises this " +
      "(complex_math_test, which imports std/math). Its operators are one-param METHODS, so there is " +
      "no module-scope `+` symbol and the import check never fires. The fix must not disturb it.",
    run: () => {
      const entry = fixture(
        "imported-method-operator",
        {
          "lib.lisp":
            `(\n` +
            `  (defstruct Money\n` +
            `    (let :ctor amount <- Int 0)\n` +
            `    (fn :operator + [other <- Money] -> Money\n` +
            `        (return (Money (+ this.amount other.amount)))))\n` +
            `  (export Money)\n` +
            `)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  (let total (+ (Money 3) (Money 4)))\n` +
            `  (console.log total.amount)\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);

      if (!out.compiled) return { ok: false, detail: "did not compile" };
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };
      return out.stdout === "7"
        ? { ok: true, detail: "an imported one-param method operator dispatches through `_1`" }
        : { ok: false, detail: `expected "7", got ${JSON.stringify(out.stdout)}` };
    },
  },

  // -----------------------------------------------------------------------------------------------
  // Sf: A PARAMETER IS NOT A TOP-LEVEL SYMBOL OF THE SAME NAME.
  // -----------------------------------------------------------------------------------------------
  {
    name: "an inlined function's PARAMETER is not replaced by a same-named top-level symbol",
    why:
      "`cloneNode` was a JSON round-trip with a cycle-breaking replacer -- and `_parent` IS the cycle, " +
      "so it was dropped. Every cloned node came out orphaned, which silently changed what its " +
      "identifiers MEAN: resolveSymbol(name, node) climbs `_parent` to find a scope, misses, and falls " +
      "through to the FLAT cross-module union, where it finds a TOP-LEVEL symbol of the same name. So " +
      "an imported function whose PARAMETER shares a name with a top-level symbol in its own module had " +
      "that parameter replaced by the symbol. This is std/math EXACTLY: it has `(fn pow [base exp] ...)` " +
      "and, separately, `(fn exp [x] ...)`. It emitted " +
      "`function __ll_inlined_pow_1(base, exp) { return Math.pow(base, __ll_inlined_exp_1); }` -- so " +
      "`(pow 2 3)` was NaN. NEVER SEEN, because the stdlib was never RUN. Sf ran it.",
    run: () => {
      const entry = fixture(
        "param-shadows-toplevel",
        {
          // The exact shape of std/math: a function `exp`, and another function with a PARAMETER
          // named `exp`. Nothing about this is exotic -- it is what any math library looks like.
          "lib.lisp":
            `(\n` +
            `  (fn exp [x <- Int] -> Int (return (* x 100)))\n` +
            // `-> Real`, not `-> Int`: the intrinsic floor (D50) types `Math.pow` as Real -> Real,
            // so `-> Int` is an LL0213 now. Irrelevant to what this fixture tests, but it has to be
            // type-correct to reach the shadowing question at all.
            `  (fn pw [base <- Int exp <- Int] -> Real (return (Math.pow base exp)))\n` +
            `  (export exp pw)\n` +
            `)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  (console.log (pw 2 3))\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);

      if (!out.compiled) return { ok: false, detail: "did not compile" };
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };

      // Output alone is the point here -- NaN is the bug -- but assert the SHAPE too: the parameter
      // must survive into the body, rather than the module-level function being spliced in.
      if (/Math\.pow\(base, __ll_inlined_exp/.test(out.code ?? "")) {
        return { ok: false, detail: "the parameter `exp` was replaced by the top-level `exp` function" };
      }
      return out.stdout === "8"
        ? { ok: true, detail: "the parameter shadows the top-level symbol, as it must" }
        : { ok: false, detail: `expected "8", got ${JSON.stringify(out.stdout)} (NaN = the bug)` };
    },
  },
  // -----------------------------------------------------------------------------------------------
  // SymbolTable.join -- docs/inbox/compiler-notes-from-repl.md #5.
  //
  // The inbox filed this as a PERFORMANCE ceiling ("blocks a truly incremental REPL") and said, in as
  // many words, "I have not chased whether that's a live bug in the normal compile path." Chased. It is
  // not a perf item. It is a CORRECTNESS bug, and these two cases are the difference between the two.
  // -----------------------------------------------------------------------------------------------
  {
    name: "a compile produces exactly ONE root scope per module file",
    why:
      "The invariant everything below rests on, pinned so it cannot drift. `SymbolTable.scopes` is a " +
      "FOREST of module roots, and `resolveSymbol`'s flat root-union is what makes a symbol from " +
      "another module visible here. That union is only sound if each module appears in it once. " +
      "A diamond (main -> a,b -> d) is the shape that tests it: `d` is reached twice, and the module " +
      "cache is the only thing stopping it from being joined twice.",
    run: () => {
      const entry = fixture(
        "one-root-per-module",
        {
          "d.lisp": `(\n  (fn d-val [] -> Int (return 7))\n  (export d-val)\n)\n`,
          "a.lisp": `(\n  (import "d.lisp")\n  (fn a-val [] -> Int (return (d-val)))\n  (export a-val)\n)\n`,
          "b.lisp": `(\n  (import "d.lisp")\n  (fn b-val [] -> Int (return (d-val)))\n  (export b-val)\n)\n`,
          "main.lisp": `(\n  (import "a.lisp")\n  (import "b.lisp")\n  (console.log (+ (a-val) (b-val)))\n)\n`,
        },
        "main.lisp"
      );

      const ctx = new Context(entry, options());
      ctx.process(entry, "types");

      const roots: any[] = (ctx.symbolTable as any).scopes;
      const files = roots.map((r) => r.node?._location?.source ?? "<none>");
      const dupes = files.filter((f, i) => files.indexOf(f) !== i);

      return dupes.length === 0
        ? { ok: true, detail: `${roots.length} roots, ${new Set(files).size} distinct modules` }
        : {
            ok: false,
            detail:
              `a module has more than one root scope: ${[...new Set(dupes)].join(", ")}. ` +
              `resolveSymbol's root-union is first-wins, so the DUPLICATE decides.`,
          };
    },
  },
  {
    name: "a reused Context re-processing a module REPLACES its symbols, it does not stack them",
    why:
      "THE BUG. `Context.process` joins each module's symbols with `SymbolTable.join`, which blind- " +
      "concats: `this.scopes = [...this.scopes, ...other.scopes]`. Re-processing a file therefore " +
      "APPENDS a second root for it and the first one never leaves. `joinWithoutDuplication` sits " +
      "directly below it and does dedupe -- by `scope.node` -- but (a) it is only called on the cached " +
      "path, where it is a no-op, and (b) node identity CANNOT work here: a re-parse yields a brand new " +
      "ProgramNode every time. The key is the MODULE, not the node. " +
      "And it is not merely a leak. `resolveSymbol`'s flat cache is FIRST-WINS " +
      "(`if (!this.symbolCache.has(k))`) over `this.scopes` in JOIN ORDER -- so the OLDEST root wins, " +
      "and a symbol from a version of the file that no longer exists beats the one that does. " +
      "Measured before the fix: `x` is a String in the source and the table says Int, forever. " +
      "That is why the REPL cannot keep a Context alive and has to replay its whole history, O(n^2), " +
      "on every keystroke.",
    run: () => {
      const entry = fixture("rejoin", { "main.lisp": `(\n  (let x 1)\n)\n` }, "main.lisp");
      const ctx = new Context(entry, options());

      /** Re-typecheck `entry` with new text, the way a live REPL would. */
      const retype = (source: string) => {
        ctx.astProvider.loadSource(entry, source);
        (ctx as any).moduleCache.delete(path.resolve(entry));
        ctx.process(entry, "types");
      };
      const rootCount = () => ((ctx.symbolTable as any).scopes as any[]).length;

      retype(`(\n  (let x 1)\n)\n`);
      const before = rootCount();

      retype(`(\n  (let x "hello")\n)\n`);
      const after = rootCount();

      if (after !== before) {
        return {
          ok: false,
          detail:
            `re-processing the SAME file grew the root forest ${before} -> ${after}. The stale root ` +
            `is still in it, and being first, it wins.`,
        };
      }

      // `inferredType`, not `type` -- SymbolEntry has no `type` field, and a gate that reads one would
      // report "<unresolved>" forever, passing for a reason that has nothing to do with the bug.
      const x: any = (ctx.symbolTable as any).resolveSymbol("x");
      const seen = String(x?.inferredType?.name ?? x?.inferredType?.kind ?? "<unresolved>");

      return seen === "String"
        ? { ok: true, detail: `roots stable at ${after}; x resolves to String` }
        : {
            ok: false,
            detail:
              `x is a String in the source, but resolveSymbol says ${seen}. A STALE symbol, from a ` +
              `version of the file that no longer exists, won.`,
          };
    },
  },

  // -----------------------------------------------------------------------------------------------
  // Phase M / Ma: a PACKAGE resolves by its manifest NAME, not by its path.
  //
  // This is what makes `package.yaml` load-bearing rather than cosmetic. The fixture is built so a
  // path search CANNOT succeed -- the manifest name matches neither the directory nor the filename --
  // so a green result can only come from the registry reading the manifest.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Ma: a package resolves by its manifest NAME, not its path",
    why:
      "Before Ma there was no registry: `(import \"pkg-alias\")` could only be a path search under the " +
      "lib roots, which finds nothing (the dir is `realdir`, the file `thing.lisp`). The manifest's " +
      "`name: pkg-alias` is the only thing that can resolve it, so a green result proves resolution is " +
      "name-driven. Verified RED by disabling the registry consult in ModuleResolver.",
    run: () => {
      // A package whose manifest NAME matches neither its directory (`realdir`) nor its file
      // (`thing.lisp`), under a lib root.
      const root = path.join(TMP, "ma-pkg-root");
      fs.rmSync(root, { recursive: true, force: true });
      const pkgDir = path.join(root, "realdir");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.yaml"), `name: pkg-alias\nsources: ["*.lisp"]\n`);
      fs.writeFileSync(
        path.join(pkgDir, "thing.lisp"),
        `(\n  (fn answer [] -> Int (return 42))\n  (export answer)\n)\n`
      );

      // The consumer lives OUTSIDE the lib root and imports by the manifest name.
      const entry = fixture(
        "ma-consumer",
        { "main.lisp": `(\n  (import "pkg-alias")\n  (console.log (answer))\n)\n` },
        "main.lisp"
      );

      // Fresh scan (the manifest was just written); lib root FIRST so `pkg-alias` resolves there, plus
      // the shipped lib/ so the `std/js` prelude (console, ...) still resolves.
      PackageRegistry.clear();
      const ctx = new Context(entry, {
        ...options(),
        libPaths: [root, ...ModuleResolver.defaultLibPaths()],
      });

      let result: any;
      try {
        result = ctx.process(entry);
      } catch (e: any) {
        return { ok: false, detail: `crash: ${String(e?.message ?? e).split("\n")[0]}` };
      }
      if (ctx.results.hasErrors || !result?.code) {
        return {
          ok: false,
          detail: `did not resolve by name: ${ctx.results.all.map((m: any) => m.code).join(",") || "no code"}`,
        };
      }

      const js = entry.replace(/\.lisp$/, ".js");
      fs.writeFileSync(js, result.code);
      const run = spawnSync("node", [js], { encoding: "utf-8", timeout: 10_000, env: CHILD_ENV });
      const stdout = (run.stdout ?? "").trim();
      return stdout === "42"
        ? { ok: true, detail: "imported by manifest name; a path search could not have found it" }
        : { ok: false, detail: `expected "42", got ${JSON.stringify(stdout)}` };
    },
  },

  // -----------------------------------------------------------------------------------------------
  // Phase M / Mb: the PACKAGE is the compilation/visibility unit, not the file.
  //
  // Two consequences: (1) files of one package see each other's names with NO export/import between
  // them -- same package, no boundary; (2) importing a package brings in the UNION of its files'
  // exports. And a guard: the widening stops at the package -- it must not leak to other packages.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Mb: a package's files see each other; an importer sees the UNION of their exports",
    why:
      "The unit is the package. `from-b` (b.lisp) calls `helper` (a.lisp) with NO import -- same " +
      "package, no boundary -- and a consumer importing the package sees `from-a` AND `from-b` though " +
      "they live in different files. Before Mb the importer resolved to ONE file (the other's exports " +
      "absent) and `helper` was LL0215 across a file boundary. Verified RED before co-processing + the " +
      "package-scoped boundary.",
    run: () => {
      const root = path.join(TMP, "mb-pkg-root");
      fs.rmSync(root, { recursive: true, force: true });
      const pkgDir = path.join(root, "twofile");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.yaml"), `name: two\nsources: ["*.lisp"]\n`);
      // a.lisp: an UNEXPORTED helper, plus an exported function.
      fs.writeFileSync(
        path.join(pkgDir, "a.lisp"),
        `(\n  (fn helper [] -> Int (return 40))     ;; NOT exported\n` +
          `  (fn from-a [] -> Int (return 2))\n  (export from-a)\n)\n`
      );
      // b.lisp: uses a.lisp's UNEXPORTED helper with NO import (same package, no boundary).
      fs.writeFileSync(
        path.join(pkgDir, "b.lisp"),
        `(\n  (fn from-b [] -> Int (return (helper)))  ;; sees a.lisp's unexported helper\n` +
          `  (export from-b)\n)\n`
      );

      const entry = fixture(
        "mb-consumer",
        { "main.lisp": `(\n  (import "two")\n  (console.log (+ (from-a) (from-b)))\n)\n` },
        "main.lisp"
      );

      PackageRegistry.clear();
      const ctx = new Context(entry, {
        ...options(),
        libPaths: [root, ...ModuleResolver.defaultLibPaths()],
      });
      let result: any;
      try {
        result = ctx.process(entry);
      } catch (e: any) {
        return { ok: false, detail: `crash: ${String(e?.message ?? e).split("\n")[0]}` };
      }
      if (ctx.results.hasErrors || !result?.code) {
        return {
          ok: false,
          detail: `did not compile: ${ctx.results.all.map((m: any) => m.code).join(",") || "no code"}`,
        };
      }
      const js = entry.replace(/\.lisp$/, ".js");
      fs.writeFileSync(js, result.code);
      const run = spawnSync("node", [js], { encoding: "utf-8", timeout: 10_000, env: CHILD_ENV });
      const stdout = (run.stdout ?? "").trim();
      // from-a() = 2, from-b() = helper() = 40 -> 42
      return stdout === "42"
        ? { ok: true, detail: "same-package files see each other; the importer sees both files' exports" }
        : { ok: false, detail: `expected "42", got ${JSON.stringify(stdout)}` };
    },
  },
  {
    name: "Mb: package visibility does NOT leak across a package boundary (guard)",
    why:
      "The widening is to the PACKAGE, not the world. A consumer that references another package's " +
      "UNEXPORTED name must still be rejected -- otherwise `internal` would mean nothing. This is what " +
      "keeps same-package visibility from becoming global.",
    run: () => {
      const root = path.join(TMP, "mb-leak-root");
      fs.rmSync(root, { recursive: true, force: true });
      const pkgDir = path.join(root, "secretpkg");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.yaml"), `name: secret-pkg\nsources: ["*.lisp"]\n`);
      fs.writeFileSync(
        path.join(pkgDir, "s.lisp"),
        `(\n  (fn hidden [] -> Int (return 7))   ;; NOT exported\n` +
          `  (fn shown [] -> Int (return 1))\n  (export shown)\n)\n`
      );

      // A consumer OUTSIDE the package reaches for the unexported `hidden`.
      const entry = fixture(
        "mb-leak-consumer",
        { "main.lisp": `(\n  (import "secret-pkg")\n  (console.log (hidden))\n)\n` },
        "main.lisp"
      );

      PackageRegistry.clear();
      const ctx = new Context(entry, {
        ...options(),
        libPaths: [root, ...ModuleResolver.defaultLibPaths()],
      });
      try {
        ctx.process(entry);
      } catch {
        /* diagnostics are the point, not a clean compile */
      }
      const diags = ctx.results.all.map((m: any) => String(m.code));
      const rejected = diags.some((d) => /LL0215|LL0210/.test(d));
      return rejected
        ? { ok: true, detail: "an unexported name is not visible across a package boundary" }
        : { ok: false, detail: `expected a visibility error, got: ${diags.join(",") || "none (it compiled)"}` };
    },
  },

  // -----------------------------------------------------------------------------------------------
  // Phase M / Mc: `:private` is FILE-scoped -- below the package default of `internal`.
  //
  // Mb made same-package files mutually visible. `:private` opts OUT of that: a private top-level name
  // is visible only in its own file, not even to package siblings. So file B referencing file A's
  // `:private` name is an error (LL0206), THOUGH they share a package.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Mc: a :private top-level name is not visible to a sibling file in the same package",
    why:
      "The three levels: `:private` (file), default `internal` (package), exported `public` (world). " +
      "Post-Mb a sibling saw file A's unexported `secret` (same package, no boundary) -- but `:private` " +
      "must be tighter than the package default. RED before Mc: `(secret)` in b.lisp compiled and ran. " +
      "After: LL0206, private to its file.",
    run: () => {
      const root = path.join(TMP, "mc-private-root");
      fs.rmSync(root, { recursive: true, force: true });
      const pkgDir = path.join(root, "pv");
      fs.mkdirSync(pkgDir, { recursive: true });
      fs.writeFileSync(path.join(pkgDir, "package.yaml"), `name: pv\nsources: ["*.lisp"]\n`);
      // a.lisp: a :private top-level name (file-scoped) plus an exported one.
      fs.writeFileSync(
        path.join(pkgDir, "a.lisp"),
        `(\n  (fn :private secret [] -> Int (return 5))   ;; FILE-private\n` +
          `  (fn shown [] -> Int (return 1))\n  (export shown)\n)\n`
      );
      // b.lisp: reaches for a.lisp's :private name -- same package, but that is not enough for private.
      fs.writeFileSync(
        path.join(pkgDir, "b.lisp"),
        `(\n  (fn use [] -> Int (return (secret)))\n  (export use)\n)\n`
      );

      const entry = fixture(
        "mc-private-consumer",
        { "main.lisp": `(\n  (import "pv")\n  (console.log (use))\n)\n` },
        "main.lisp"
      );

      PackageRegistry.clear();
      const ctx = new Context(entry, {
        ...options(),
        libPaths: [root, ...ModuleResolver.defaultLibPaths()],
      });
      try {
        ctx.process(entry);
      } catch {
        /* diagnostics are the point */
      }
      const diags = ctx.results.all.map((m: any) => String(m.code));
      const rejected = diags.some((d) => /LL0206/.test(d));
      return rejected
        ? { ok: true, detail: "`:private` is file-scoped -- a sibling file cannot see it" }
        : { ok: false, detail: `expected LL0206 (private), got: ${diags.join(",") || "none (it compiled)"}` };
    },
  },
  {
    name: "Mc: :protected is rejected -- removed from the language",
    why:
      "`protected` was a no-op (written to reflection metadata, enforced by nothing) and it is the " +
      "implementation-inheritance leak modern design rejects -- Go and Rust have none. Mc deletes it " +
      "from VISIBILITY_MODIFIERS, so D4 refuses it by name (LL0015), the way it refused `:nullable`. " +
      "RED before Mc: `:protected` was a valid visibility modifier and compiled silently.",
    run: () => {
      const entry = fixture(
        "mc-protected",
        { "main.lisp": `(\n  (fn :protected f [] -> Int (return 1))\n  (console.log (f))\n)\n` },
        "main.lisp"
      );
      const out = build(entry);
      const rejected = out.diagnostics.some((d) => /LL0015/.test(d));
      return rejected
        ? { ok: true, detail: "`:protected` is refused (LL0015), like any unknown modifier" }
        : {
            ok: false,
            detail: `expected LL0015, got: ${out.diagnostics.join(",") || (out.compiled ? "compiled clean" : "no diagnostics")}`,
          };
    },
  },

  // Zh -- `type` never got the `__ll_name` fix that `__ll_is_type` got.
  // ===============================================================================================
  {
    name: "Zh: `(type x)` on an IMPORTED class reports the SOURCE name",
    why:
      "An import is INLINED under a mangled JS name (`__ll_inlined_Money_1`), so `constructor.name` " +
      "is the mangler's name, not the type's. `__ll_is_type` was fixed to read `static __ll_name` " +
      "FIRST and DECISIONS.md records the rename as FIXED -- but the fix landed in ONE of the two " +
      "consumers. `type` still reads `constructor.name`, so it reports a name that appears nowhere " +
      "in the user's source and that no other part of the language answers to.",
    run: () => {
      const entry = fixture(
        "type-inlined-name",
        {
          "money.lisp": `(\n  (defclass Money\n    (fn amount [] -> Int (return 5)))\n  (export Money)\n)\n`,
          "main.lisp":
            `(\n` +
            `  (import "money.lisp")\n` +
            `  (let m (Money))\n` +
            `  (let t (type m))\n` +
            `  (console.log t["name"])\n` +
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

      // Guard the premise: if the import is NOT inlined under a mangled name, this test proves
      // nothing and must say so rather than pass green.
      if (!/__ll_inlined_\w*Money/.test(out.code ?? "")) {
        return { ok: false, detail: "premise gone: `Money` is no longer inlined under a mangled name" };
      }

      return out.stdout === "Money"
        ? { ok: true, detail: "reports `Money`, the name in the source" }
        : { ok: false, detail: `expected "Money", got ${JSON.stringify(out.stdout)}` };
    },
  },

  // Zl/reexport -- exporting a name the module does not define used to CRASH the compile with a raw
  // `throw new Error("Export error: symbol not found")` -- a JS stack trace, no source location.
  // Now a located diagnostic (LL0232). Covers the typo case and the unsupported re-export case alike.
  {
    name: "Zl: exporting an undefined name is a diagnostic, not a crash",
    why:
      "A raw throw in ResolvePassVisitor.visitExport took down the whole compile with a Node stack " +
      "trace. The same 'unsupported must be diagnosed, not crash' pattern the namespace-import gap " +
      "already follows. Re-export stays unsupported -- a consumer imports from the defining module.",
    run: () => {
      const entry = fixture(
        "bad-export",
        { "main.lisp": `(\n  (fn real [] -> Int (return 1))\n  (export nonexistent-thing)\n)\n` },
        "main.lisp"
      );
      const out = build(entry);
      const reported = out.diagnostics.some((d) => /LL0232/.test(d));
      const crashed = /Export error|symbol not found/.test(out.runtimeError ?? "");
      return reported && !crashed
        ? { ok: true, detail: "LL0232 reported; no crash" }
        : {
            ok: false,
            detail: crashed
              ? `still crashes: ${out.runtimeError}`
              : `expected LL0232, got: ${out.diagnostics.join(",") || "(none)"}`,
          };
    },
  },

  // S1a / N14 -- the most expensive finding the games repo produced, and the reason Phase S1 exists.
  {
    name: "S1a: an imported body keeps its static types -- `(/ Int Int)` stays integer division",
    why:
      "D49d decides division from the STATIC types of the operands, at HIR lowering " +
      "(LowerAstToHirVisitor.isIntDivision reads args[].type). Across an import those types were " +
      "GONE, so `/` fell back to the generic operator shim and a function declared `-> Int` " +
      "returned 3.5 -- silently, with no diagnostic from either backend, and with the two backends " +
      "disagreeing (C re-coerced at the next typed parameter and landed on the right answer by " +
      "accident). It produced a correct minesweeper board on C and a wrong one on JS from one source " +
      "file.\n" +
      "ROOT CAUSE: `Context.nodeTypes` was REPLACED per module, not accumulated. The dependency-graph " +
      "pass (symbols stage) recurses into each import and publishes ITS node types; the importer's own " +
      "types stage then overwrites the channel. By codegen the imported body's types no longer exist, " +
      "and the on-demand HIR lowering of an inlined body reads an empty map. The map is identity-keyed " +
      "by AST node and modules own distinct node objects, so accumulating is sound.\n" +
      "The goldens below are derived from D49d, not captured: 7/2=3, 1/9=0, 7/2=3.",
    run: () => {
      const entry = fixture(
        "imported-int-division",
        {
          "lib.lisp":
            `(\n` +
            `  ;; a free function -- the minimal shape\n` +
            `  (fn half [n <- Int] -> Int (return (/ n 2)))\n` +
            `  ;; both operands LITERAL: proves the Int literal keeps its BigInt-ness across the boundary\n` +
            `  (fn seven-halved [] -> Int (return (/ 7 2)))\n` +
            `  ;; the shape that actually bit -- a method recovering a row from a flat index\n` +
            `  (defclass Grid\n` +
            `    (let :ctor width <- Int 9)\n` +
            `    (fn row-of [i <- Int] -> Int (return (/ i this.width))))\n` +
            `  (export half seven-halved Grid)\n` +
            `)\n`,
          "main.lisp":
            `(\n` +
            `  (import "lib.lisp")\n` +
            `  ;; a SAME-FILE control: this shape has always been correct and must stay correct\n` +
            `  (fn local-half [n <- Int] -> Int (return (/ n 2)))\n` +
            `  (let g (new Grid 9))\n` +
            `  (console.log (half 7) (seven-halved) (g.row-of 1) (local-half 7))\n` +
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

      // 7/2 -> 3, 7/2 -> 3, 1/9 -> 0, 7/2 -> 3. Every one truncates, per D49d.
      if (out.stdout !== "3 3 0 3") {
        return {
          ok: false,
          detail:
            `expected "3 3 0 3", got ${JSON.stringify(out.stdout)} ` +
            `-- a fractional answer means the imported body lost its types and took the generic '/' shim`,
        };
      }

      // The stronger assertion, and the one that survives a lucky answer: the IMPORTED body must
      // emit `__ll_intdiv`, not the generic `_2f` operator shim. Output alone would go green on a
      // backend that re-coerces downstream, which is exactly how this hid on C.
      const code = out.code ?? "";
      const inlinedHalf = /function __ll_inlined_half\w*\([^)]*\)\s*{[^}]*}/.exec(code)?.[0] ?? "";
      if (!inlinedHalf) {
        return { ok: false, detail: "premise gone: `half` is no longer inlined under a mangled name" };
      }
      if (!/__ll_intdiv/.test(inlinedHalf)) {
        return {
          ok: false,
          detail: `the inlined body still uses the generic '/' shim: ${inlinedHalf.replace(/\s+/g, " ")}`,
        };
      }

      return { ok: true, detail: "imported bodies divide as Int; the same-file control is unchanged" };
    },
  },

  // S1b / N1 + N15 + N2 -- three findings, ONE bug. `resolveSymbol`'s fall-through is a flat
  // first-wins union over every loaded module root, in module-JOIN order, so which `write-line` /
  // `iabs` / `rect` you get is decided by which module happened to be processed first. A stdlib
  // module always wins, because the prelude and the package co-processing get there earlier.
  {
    name: "S1b/N1: a DIRECTLY imported name beats a transitively-reached stdlib one",
    why:
      "`mid.lisp` defines and exports a one-parameter `write-line`; `std/io/stream` exports a " +
      "two-parameter one and is reached only TRANSITIVELY (mid imports it, main does not). Main's " +
      "call resolved to the stdlib's, so a one-argument call to a one-parameter function one file " +
      "away reported `ELL0211 expects 2 arguments, got 1` and `ELL0203 expected Writer, got String`. " +
      "A selective import does not contain it: the union is keyed by DECLARED name across all roots. " +
      "The working rule the games corpus had to adopt -- never reuse a name the stdlib exports -- is " +
      "not checkable without reading lib/.",
    run: () => {
      const entry = fixture(
        "direct-beats-transitive",
        {
          "mid.lisp":
            `(\n` +
            `  (import { stdout } from "std/io/stream")\n` +
            `  (fn write-line [text <- String] -> Void (stdout.write (+ text "\\n")))\n` +
            `  (export write-line)\n` +
            `)\n`,
          "main.lisp": `(\n  (import "mid.lisp")\n  (write-line "hello")\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      if (!out.compiled) {
        return { ok: false, detail: `did not compile: ${out.diagnostics.join(", ") || "(no diagnostics)"}` };
      }
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };
      return out.stdout === "hello"
        ? { ok: true, detail: "the directly-imported one-parameter `write-line` won" }
        : { ok: false, detail: `expected "hello", got ${JSON.stringify(out.stdout)}` };
    },
  },

  {
    name: "S1b/N15: a package's PRIVATE sibling name does not shadow an importer's own export",
    why:
      "`std/math/rational.lisp` has a private `iabs`. Importing ONE name from the std/math package " +
      "co-processes every sibling, and their private top-level names entered the same flat union -- " +
      "where they outranked the importing module's own. The diagnostic was " +
      "`ELL0215 'iabs' is defined in 'rational.lisp' but is not exported`: a stdlib file the program " +
      "never named, about a function this module defines AND exports. The FENCE was right " +
      "(checkSymbolVisible asked the correct question); resolution handed it the wrong symbol. " +
      "26 modules leak 32 private top-level names this way today.",
    run: () => {
      const entry = fixture(
        "private-sibling-leak",
        {
          "num.lisp":
            `(\n` +
            `  (import { truncate } from "std/math")\n` +
            `  (fn iabs [n <- Int] -> Int (if (< n 0) (- 0 n) n))\n` +
            `  (export iabs)\n` +
            `)\n`,
          "main.lisp": `(\n  (import "num.lisp")\n  (console.log (iabs -5))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      if (!out.compiled) {
        return {
          ok: false,
          detail: `did not compile: ${out.diagnostics.join(", ") || "(no diagnostics)"}`,
        };
      }
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };
      return out.stdout === "5"
        ? { ok: true, detail: "the importer's own `iabs` won over the stdlib's private one" }
        : { ok: false, detail: `expected "5", got ${JSON.stringify(out.stdout)}` };
    },
  },

  {
    name: "S1b/N2: a package sibling does not shadow the importing module's own declaration",
    why:
      "Importing ANY member of a package brings its siblings. `std/math/complex` exports a " +
      "two-parameter `rect`, which outranked a local five-parameter `rect` in a module that had " +
      "imported std/math/vector for an unrelated reason -- and the module then re-exported the " +
      "sibling's under its own name. Loud here only because the arities differ; SILENT whenever " +
      "they agree, which is the case worth fearing.",
    run: () => {
      const entry = fixture(
        "sibling-shadows-local",
        {
          "bind.lisp":
            `(\n` +
            `  (import "std/math/vector")\n` +
            `  (fn rect [x <- Int y <- Int w <- Int h <- Int r <- Int] -> String\n` +
            `      (return '"rect {(x)} {(y)} {(w)} {(h)} {(r)}"))\n` +
            `  (export rect)\n` +
            `)\n`,
          "main.lisp": `(\n  (import "bind.lisp")\n  (console.log (rect 1 2 3 4 5))\n)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      if (!out.compiled) {
        return {
          ok: false,
          detail: `did not compile: ${out.diagnostics.join(", ") || "(no diagnostics)"}`,
        };
      }
      if (out.runtimeError) return { ok: false, detail: `runtime: ${out.runtimeError}` };
      return out.stdout === "rect 1 2 3 4 5"
        ? { ok: true, detail: "the module's own five-parameter `rect` won" }
        : { ok: false, detail: `expected "rect 1 2 3 4 5", got ${JSON.stringify(out.stdout)}` };
    },
  },

  // S1c -- the duplicate-symbol gate Dove's stdlib roadmap asks for "before the module count
  // doubles". S1b made resolution deterministic; this says when determinism was never the file's to
  // rely on.
  {
    name: "S1c: two directly-imported PACKAGES offering one name is LL0240",
    why:
      "`std/iter/linq` and `std/seq` both export `map` -- legally, under D33's two conventions " +
      "(lazy/collection-first vs eager/collection-last). A file importing both gets whichever root " +
      "the forest reaches first, which is an accident of module processing order, so a program that " +
      "reads correctly today can change meaning when an unrelated import is added. A WARNING, not an " +
      "error: this is legal and the corpus does it on purpose. It must still compile and run.",
    run: () => {
      const entry = fixture(
        "ambiguous-import",
        {
          "main.lisp":
            `(\n` +
            `  (import "std/iter")\n` +
            `  (import "std/iter/linq")\n` +
            `  (import "std/seq")\n` +
            `  (console.log ((map [1 2 3] (fn [x] (* x 2))).length))\n` +
            `)\n`,
        },
        "main.lisp"
      );
      const out = build(entry);
      const warned = out.diagnostics.some((d) => /LL0240/.test(d));
      if (!warned) {
        return {
          ok: false,
          detail: `expected LL0240, got: ${out.diagnostics.join(", ") || "(none)"}`,
        };
      }
      // A warning must not break the build -- that is the whole reason it is a warning.
      return out.compiled
        ? { ok: true, detail: "LL0240 warns, and the program still compiles" }
        : { ok: false, detail: "LL0240 fired but the program stopped compiling -- it must be a warning" };
    },
  },

  {
    name: "S1c: a SAME-package duplicate does not warn (negative control)",
    why:
      "25 exported names in the stdlib are owned by more than one module, and most are same-package " +
      "re-exports -- `std/math/math` republishes `std/math/constants`' PI. A package publishing the " +
      "union of its files' exports is Mb working as designed, not a collision. If LL0240 fired here " +
      "it would be noise on every math program, and a diagnostic that cannot stay quiet gets ignored.",
    run: () => {
      const entry = fixture(
        "same-package-dup",
        { "main.lisp": `(\n  (import "std/math")\n  (console.log (> PI 3.0))\n)\n` },
        "main.lisp"
      );
      const out = build(entry);
      const warned = out.diagnostics.filter((d) => /LL0240/.test(d));
      if (warned.length > 0) {
        return { ok: false, detail: `LL0240 fired on a same-package re-export: ${warned.join(", ")}` };
      }
      if (!out.compiled) {
        return { ok: false, detail: `did not compile: ${out.diagnostics.join(", ") || "(none)"}` };
      }
      return out.stdout === "true"
        ? { ok: true, detail: "no warning for a package republishing its own file's export" }
        : { ok: false, detail: `expected "true", got ${JSON.stringify(out.stdout)}` };
    },
  },

  // S1d / N11 -- graded on BOTH backends, because it broke on both and the fixes are in different
  // pipelines (the JS inliner; the C enum table).
  {
    name: "S1d/N11: an imported defenum's members resolve, on both backends",
    why:
      "`(defenum Dir :up :down)` emits one binding per member, named from the ENUM's source spelling " +
      "(`Dir3aup`). The symbol table registers the ENUM and never its MEMBERS, so across an import " +
      "`Dir:up` resolved to nothing at all: the JS inliner was never consulted and the reference fell " +
      "through to a bare mangled name (`ReferenceError: Dir3aup is not defined`), while the C backend " +
      "builds its enum table only from the ROOT module's declarations and emitted " +
      "`use of undeclared identifier 'u_Dir_3aup'`. Zero diagnostics from either backend. It survived " +
      "because every enum user in the corpus was a single file -- the audit's own test, 'do not ask " +
      "is it implemented, ask who calls it'.\n" +
      "All four use sites the games report names are covered: a member passed as an argument, one " +
      "read inside an imported function body, one in a class field default, and one at the " +
      "importer's own top level.",
    run: () => {
      const files = {
        "lib.lisp":
          `(\n` +
          `  (defenum Dir :up :down)\n` +
          `  (fn name-of [d <- Dir] -> String (return (if (== d Dir:up) "up" "down")))\n` +
          `  (defclass Marker (mut facing <- Int Dir:down))\n` +
          `  (export Dir name-of Marker)\n` +
          `)\n`,
        "main.lisp":
          `(\n` +
          `  (import "lib.lisp")\n` +
          // Bound, not read inline: `(new Marker).facing` is a separate pre-existing ELL0210 and has
          // nothing to do with enums -- inlining it here would grade the wrong thing.
          `  (let m (new Marker))\n` +
          `  (console.log (name-of Dir:up) (name-of Dir:down) m.facing Dir:up)\n` +
          `)\n`,
      };
      const expected = "up down 1 0";

      const js = build(fixture("imported-enum-js", files, "main.lisp"));
      if (!js.compiled) return { ok: false, detail: `JS did not compile: ${js.diagnostics.join(", ") || "(none)"}` };
      if (js.runtimeError) return { ok: false, detail: `JS runtime: ${js.runtimeError}` };
      if (js.stdout !== expected) {
        return { ok: false, detail: `JS expected ${JSON.stringify(expected)}, got ${JSON.stringify(js.stdout)}` };
      }

      const c = buildC(fixture("imported-enum-c", files, "main.lisp"));
      if (!c.compiled) return { ok: false, detail: `C did not build: ${c.runtimeError ?? (c.diagnostics.join(", ") || "(none)")}` };
      if (c.runtimeError) return { ok: false, detail: `C runtime: ${c.runtimeError}` };
      if (c.stdout !== expected) {
        return { ok: false, detail: `C expected ${JSON.stringify(expected)}, got ${JSON.stringify(c.stdout)}` };
      }

      return { ok: true, detail: `both backends agree: ${expected}` };
    },
  },

  // T1 -- the S1b residual, one namespace over. S1b made a VALUE name prefer the module a file
  // directly imports over one reached only transitively (N1). TYPE references took a different, bare
  // path, so a cross-module TYPE-name collision still resolved by first-wins processing order.
  {
    name: "T1: a cross-module TYPE-name collision resolves to the directly-imported definition",
    why:
      "Two modules each export a class `Widget` of different shape. `mid.lisp` imports the Int one; " +
      "`main.lisp` imports `mid` (so it reaches the Int `Widget` TRANSITIVELY) and then the String " +
      "`Widget` DIRECTLY. A type annotation `<- Widget` and `(new Widget ...)` in main must bind the " +
      "DIRECTLY-imported (String) one -- exactly as a value name would under S1b. It did not: a type " +
      "reference lowers to a deferred `type-ref{refName}` (convertAstTypeCore) resolved lazily by " +
      "`TypeChecker.unwrapType` via a BARE `resolveSymbol(refName)` with no asking-file, so it landed " +
      "on whichever `Widget` was joined first -- a spurious `ELL0203 expected Int, got String`. Fixed " +
      "by stamping the asking source on the type-ref and resolving it with import priority. Checker-" +
      "level, so it reproduces identically on both backends; graded on both to keep it honest.",
    run: () => {
      const files = {
        "wstr.lisp":
          `(\n` +
          `  (defclass Widget (let :ctor label <- String))\n` +
          `  (fn make-widget [] -> Widget (return (new Widget "from-A")))\n` +
          `  (export Widget make-widget)\n` +
          `)\n`,
        "wint.lisp":
          `(\n` +
          `  (defclass Widget (let :ctor code <- Int))\n` +
          `  (export Widget)\n` +
          `)\n`,
        // mid reaches the Int Widget; main imports mid (transitive Int) THEN wstr (direct String).
        "mid.lisp": `(\n  (import "wint.lisp")\n  (fn ping [] -> Int (return 1))\n  (export ping)\n)\n`,
        "main.lisp":
          `(\n` +
          `  (import "mid.lisp")\n` +
          `  (import "wstr.lisp")\n` +
          `  ;; a TYPE annotation referencing the directly-imported Widget (String), even though the\n` +
          `  ;; Int one is joined FIRST (transitively via mid)\n` +
          `  (fn label-of [w <- Widget] -> String (return w.label))\n` +
          `  ;; construction of the directly-imported Widget, and one built by the imported factory\n` +
          `  (let w (new Widget "direct"))\n` +
          `  (console.log (label-of w) (label-of (make-widget)))\n` +
          `)\n`,
      };
      const expected = "direct from-A";

      const js = build(fixture("type-collision-js", files, "main.lisp"));
      if (!js.compiled) return { ok: false, detail: `JS did not compile: ${js.diagnostics.join(", ") || "(none)"}` };
      if (js.runtimeError) return { ok: false, detail: `JS runtime: ${js.runtimeError}` };
      if (js.stdout !== expected) {
        return { ok: false, detail: `JS expected ${JSON.stringify(expected)}, got ${JSON.stringify(js.stdout)} -- the wrong Widget won` };
      }

      const c = buildC(fixture("type-collision-c", files, "main.lisp"));
      if (!c.compiled) return { ok: false, detail: `C did not build: ${c.runtimeError ?? (c.diagnostics.join(", ") || "(none)")}` };
      if (c.runtimeError) return { ok: false, detail: `C runtime: ${c.runtimeError}` };
      if (c.stdout !== expected) {
        return { ok: false, detail: `C expected ${JSON.stringify(expected)}, got ${JSON.stringify(c.stdout)}` };
      }

      return { ok: true, detail: `the directly-imported Widget won on both backends: ${expected}` };
    },
  },

  // T1b -- a module's OWN class extending an IMPORTED parent. Surfaced while building T1: once the
  // checker stopped refusing a `:extends` on a cross-module type, codegen was exposed. It is a
  // pre-existing gap independent of any collision, absent from the corpus, and broken on BOTH backends:
  // JS emitted `class Sub extends Base` with the bare (inliner-renamed) parent name; C never
  // registered the imported parent so the inherited field layout was wrong. The E2 fixes covered the
  // INLINED subclass path; this is the same gap on the non-inlined path (a root-module class).
  {
    name: "T1b: a module's own class extends an IMPORTED parent, on both backends",
    why:
      "`Sub :extends Base` where `Base` is imported. JS: the HIR class-shell emitter took the super " +
      "name from `HClass.superName` verbatim, so `extends Base` referenced the bare name the import " +
      "inliner had renamed to `__ll_inlined_Base_1` -- undefined at run time. C: a local class's " +
      "imported parent was not registered, so the inherited ctor field layout was wrong " +
      "(`value has no such member`). Both are the E2 gap on the non-inlined path; the fix resolves the " +
      "parent through the inliner (JS) and the parent-chain registration (C).",
    run: () => {
      const files = {
        "base.lisp": `(\n  (defclass Base (let :ctor name <- String))\n  (export Base)\n)\n`,
        "main.lisp":
          `(\n` +
          `  (import "base.lisp")\n` +
          `  (defclass Sub :extends Base (let :ctor n <- Int))\n` +
          `  (let s (new Sub "hi" 5))\n` +
          `  ;; inherited field + own field + a subtype catch by the imported parent type\n` +
          `  (console.log s.name s.n)\n` +
          `  (try (throw (new Sub "boom" 9))\n` +
          `       catch e :of Base (console.log "caught" e.name))\n` +
          `)\n`,
      };
      const expected = "hi 5\ncaught boom";

      const js = build(fixture("own-extends-imported-js", files, "main.lisp"));
      if (!js.compiled) return { ok: false, detail: `JS did not compile: ${js.diagnostics.join(", ") || "(none)"}` };
      if (js.runtimeError) return { ok: false, detail: `JS runtime: ${js.runtimeError}` };
      if (js.stdout !== expected) return { ok: false, detail: `JS expected ${JSON.stringify(expected)}, got ${JSON.stringify(js.stdout)}` };

      const c = buildC(fixture("own-extends-imported-c", files, "main.lisp"));
      if (!c.compiled) return { ok: false, detail: `C did not build: ${c.runtimeError ?? (c.diagnostics.join(", ") || "(none)")}` };
      if (c.runtimeError) return { ok: false, detail: `C runtime: ${c.runtimeError}` };
      if (c.stdout !== expected) return { ok: false, detail: `C expected ${JSON.stringify(expected)}, got ${JSON.stringify(c.stdout)}` };

      return { ok: true, detail: `own class extends imported parent on both backends: ${JSON.stringify(expected)}` };
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

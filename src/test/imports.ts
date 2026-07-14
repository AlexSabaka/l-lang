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
            `  (fn pw [base <- Int exp <- Int] -> Int (return (Math.pow base exp)))\n` +
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

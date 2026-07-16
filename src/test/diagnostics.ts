#!/usr/bin/env ts-node
/**
 * The gate for the diagnostics-centralization refactor (Phase E).
 *
 * TWO jobs:
 *
 *  1. REGISTRY INTEGRITY + THE ALLOCATOR.  Reads `rules/diagnostics` and asserts every code is
 *     well-formed and single-severity, then prints which LL codes are TAKEN per band and the next
 *     FREE number in each -- so allocating a new code is a lookup here, not a `grep "LL0"` across the
 *     tree. (Empty until Eb starts migrating categories in.)
 *
 *  2. THE CHARACTERIZATION SNAPSHOT.  This is the falsifier for a behaviour-PRESERVING refactor. It
 *     runs a fixed set of probes through the type stage and records every diagnostic's raw
 *     `(code, severity, text)` -- the interpolated sentence, with no colour, path or terminal-width
 *     in it, so it is deterministic. The snapshot is captured against the CURRENT (pre-migration)
 *     compiler in Ea; every later phase must leave it BYTE-IDENTICAL. A migration that reworded a
 *     message, dropped an interpolation, or changed a code shows up here as a diff.
 *
 *     Discipline for Eb+: no def is migrated without a probe that pins its output. A code with no
 *     probe is a code the snapshot cannot protect.
 *
 * Usage:
 *   npm run test:diagnostics            # integrity + snapshot must match  (exit 1 on any diff)
 *   npm run test:diagnostics -- --list  # also print the code->names allocator map
 *   npm run test:diagnostics -- --update # re-capture the snapshot (only when a change is INTENDED)
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";
import { RuleSeverity } from "../compiler/rules/RuleBuilder";
import {
  DIAGNOSTIC_CATEGORIES,
  EXTERNAL_CODES,
} from "../compiler/rules/diagnostics";

const UPDATE = process.argv.includes("--update");
const LIST = process.argv.includes("--list");
const SNAPSHOT = path.resolve(__dirname, "snapshots/diagnostics.snapshot.json");

// ---------------------------------------------------------------------------
// Part 1 -- registry integrity + the free-code allocator.
// ---------------------------------------------------------------------------
interface CodeOwner {
  category: string;
  name: string;
  severity: RuleSeverity;
}

function checkRegistry(): { failures: string[] } {
  const failures: string[] = [];
  const owners = new Map<string, CodeOwner[]>();

  for (const [category, defs] of Object.entries(DIAGNOSTIC_CATEGORIES)) {
    for (const [name, d] of Object.entries(defs)) {
      if (!/^LL\d{4}$/.test(d.code)) {
        failures.push(`${category}.${name}: malformed code '${d.code}' (want LLdddd)`);
      }
      const list = owners.get(d.code) ?? [];
      list.push({ category, name, severity: d.severity });
      owners.set(d.code, list);
    }
  }

  // A code names one DIAGNOSTIC IDENTITY -- so it may be reused by several message variants (LL0204
  // covers three "operator not defined" shapes), but every use must agree on SEVERITY. A code that is
  // an error in one place and a warning in another is a bug in the registry, not a variant.
  for (const [code, list] of owners) {
    const severities = new Set(list.map((o) => o.severity));
    if (severities.size > 1) {
      failures.push(
        `code ${code} has conflicting severities: ` +
          list.map((o) => `${o.category}.${o.name}=${o.severity}`).join(", ")
      );
    }
  }

  // The allocator view. Every code the registry knows about, plus the external (declarative-rule)
  // codes, so "next free" does not collide with a code that lives elsewhere.
  const taken = new Set<string>([...owners.keys(), ...EXTERNAL_CODES]);
  const bands = new Map<string, string[]>(); // "LL02" -> sorted taken codes
  for (const code of taken) {
    const band = code.slice(0, 4); // LL0x
    (bands.get(band) ?? bands.set(band, []).get(band)!).push(code);
  }

  console.log("=== diagnostics registry ===");
  console.log(
    `  registered: ${[...owners.keys()].length} codes across ` +
      `${Object.keys(DIAGNOSTIC_CATEGORIES).length} categories` +
      (EXTERNAL_CODES.length ? ` (+${EXTERNAL_CODES.length} external)` : "")
  );
  if (bands.size === 0) {
    console.log("  (registry empty -- categories are migrated in from Eb)");
  }
  for (const [band, codes] of [...bands.entries()].sort()) {
    codes.sort();
    console.log(`  ${band}xx: ${codes.length} taken, next free ${nextFree(band, taken)}`);
    if (LIST) {
      for (const code of codes) {
        const who = (owners.get(code) ?? [])
          .map((o) => `${o.category}.${o.name}`)
          .join(", ");
        console.log(`      ${code}  ${who || "(external)"}`);
      }
    }
  }

  // Surface any overlap: a registry code that ALSO appears in EXTERNAL_CODES is a migrated diagnostic
  // sharing its number with a declarative rule. Currently empty -- the one such case (LL0015-LL0019) was
  // resolved in D38 by moving the declarative colliders to LL0024-LL0028. Kept as a guard against a new one.
  const external = new Set(EXTERNAL_CODES);
  const overlap = [...owners.keys()].filter((c) => external.has(c)).sort();
  if (overlap.length) {
    console.log(
      `  NOTE: ${overlap.length} code(s) overloaded with declarative rules (finding): ${overlap.join(", ")}`
    );
  }

  return { failures };
}

/** First unused LLxxNN in a band (e.g. band "LL02" -> LL0200..LL0299). */
function nextFree(band: string, taken: Set<string>): string {
  for (let n = 0; n < 100; n++) {
    const code = `${band}${n.toString().padStart(2, "0")}`;
    if (!taken.has(code)) return code;
  }
  return `${band}xx (full)`;
}

// ---------------------------------------------------------------------------
// Part 2 -- the characterization snapshot.
// ---------------------------------------------------------------------------
interface Probe {
  name: string;
  source: string;
  /** Stage to compile to. Defaults to "types"; codegen diagnostics (LL01xx) need "codegen". */
  stage?: "types" | "codegen";
}

/**
 * Deterministic triggers, one per code/message we want pinned. Sourced from the type-errors corpus
 * cases -- kept dep-free (no sibling imports) so the runner stays a plain "write a temp file, type it,
 * read the diagnostics" loop. The SILENT probes are guards: they must keep producing nothing, so a
 * migration cannot start emitting a spurious diagnostic unnoticed.
 */
const PROBES: Probe[] = [
  // --- produce a diagnostic (the migration must reproduce each verbatim) ---
  { name: "LL0200 type mismatch on let", source: '(let x <- Int "str")' },
  { name: "LL0201 if condition not Boolean", source: '(if "str" 1 2)' },
  { name: "LL0202 compound assignment mismatch", source: '(mut x <- Int 1)\n(x := "str")' },
  {
    name: "LL0203 argument type mismatch",
    source: '(fn g [n <- Int] -> Int (return n))\n(fn f [] -> Int (let s "x") (return (g s)))',
  },
  {
    name: "LL0204 operator not defined (param)",
    source: "(fn f [s <- String] -> Int (return (- s 1)))",
  },
  {
    name: "LL0204 operator not defined (solved generic)",
    source: '(fn ident<T> [x <- T] -> T (return x))\n(let bad (- (ident "str") 1))',
  },
  {
    name: "LL0205 optional not unwrapped (builtin head)",
    source: "(let xs [1 2 3])\n(let h (head xs))\n(console.log (+ h 1))",
  },
  { name: "LL0210 unresolved identifier", source: "(undefined-fn 1)" },
  { name: "LL0211 arity too many args", source: "(fn f [a <- Int] -> Int a)\n(f 1 2 3)" },
  { name: "LL0211 arity too few args", source: "(fn f [a <- Int b <- Int] -> Int a)\n(f 1)" },
  { name: "LL0213 return type mismatch", source: '(fn f [] -> Int (return "str"))' },
  {
    name: "LL0213 implicit return (call tail)",
    source: '(fn g [] -> String (return "s"))\n(fn f [] -> Int (g))',
  },
  {
    name: "LL0214 :out in parameter position",
    source: "(definterface P<:out T> (fn f [x <- T] -> Void))",
  },
  {
    name: "LL0214 :in in return position",
    source: "(definterface C<:in T> (fn f [] -> T))",
  },
  { name: "LL0219 use before declaration", source: "(let a x)\n(let x 1)\n(console.log a)" },
  {
    name: "LL0200 via :extension return typing",
    source:
      "(defstruct Foo (let :ctor v <- Int 0))\n" +
      "(fn :extension as-int [self <- Foo] -> Int 42)\n" +
      "(let f (Foo 1))\n" +
      "(let s <- String (f.as-int))",
  },
  { name: "LL0204 operator not defined (unary)", source: '(let s "x")\n(console.log (- s))' },
  {
    name: "LL0206 private member access",
    source: "(defclass C (let :private v <- Int 0))\n(let c (C))\n(console.log c.v)",
  },
  {
    name: "LL0208 in-type operator arity",
    source:
      "(defstruct M (let :ctor a <- Int 0)\n" +
      "  (fn :operator + [x <- M y <- M] -> M (return x)))",
  },
  { name: "LL0212 duplicate declaration", source: "(let d 1)\n(let d 2)" },
  { name: "LL0221 for-each over non-iterable", source: "(for :each x :from 5 :then (console.log x))" },
  { name: "LL0222 yield outside :gen", source: "(fn f [] -> Int (yield 1))" },
  {
    name: "LL0223 :gen returns a value",
    source: "(fn :gen g [] -> Iterator<Int> (yield 1) (return 5))",
  },
  { name: "LL0224 :gen wrong return type", source: "(fn :gen g [] -> Int (yield 1))" },
  {
    name: "LL0225 :gen yield type mismatch",
    source: '(fn :gen g [] -> Iterator<Int> (yield "s"))',
  },
  { name: "LL0226 :gen never yields", source: "(fn :gen g [] -> Iterator<Int> (return))" },
  { name: "LL0227 await outside :async", source: "(fn f [] -> Int (await 1))" },
  { name: "LL0228 :async wrong return type", source: "(fn :async f [] -> Int 1)" },
  { name: "LL0229 :extension without receiver", source: "(fn :extension foo [] -> Int 1)" },
  {
    name: "LL0230 lazy op on a bare array",
    source: '(import "std/linq")\n(let xs [1 2 3])\n(console.log (xs.take 2))',
  },

  // --- syntax/modifier band (LL0015-LL0019, LL0023), emitted by SyntaxRulesAstVisitor ---
  { name: "LL0015 unknown modifier", source: "(fn :zzz foo [] -> Int 1)" },
  { name: "LL0016 reserved native modifier", source: "(fn :gc foo [] -> Int 1)" },
  {
    name: "LL0017 duplicate for clause",
    source: "(let xs [1 2])\n(let ys [3 4])\n(for :each x :from xs :from ys :then (console.log x))",
  },
  { name: "LL0018 missing for clause", source: "(for :each x :then (console.log x))" },
  { name: "LL0023 defmacro is reserved", source: "(defmacro foo [] 1)" },

  // --- codegen band (LL0100-LL0102): the backend must actually run, so stage "codegen" ---
  { name: "LL0102 non-name in binding position", source: "(let [1] [5])", stage: "codegen" },
  {
    name: "LL0102 constructor default before required",
    source: "(defstruct S (let :ctor a <- Int 0) (let :ctor b <- Int))",
    stage: "codegen",
  },

  // --- module band (LL0217): import resolution runs early, so stage "types" is enough ---
  { name: "LL0217 unresolved import", source: '(import "no_such_xyz_module.lisp")' },

  // --- comptime band (LL0099) ---
  {
    name: "LL0099 comptime arg not literal",
    source: "(fn :comptime double [x <- Int] -> Int (* x 2))\n(let y 5)\n(console.log (double y))",
    stage: "codegen",
  },

  // --- guards: these are correct programs; the type stage must stay silent on them ---
  { name: "silent: annotated arithmetic", source: "(let a <- Int 1)\n(let b <- Int 2)\n(console.log (+ a b))" },
  { name: "silent: a parameter resolves", source: "(fn f [n <- Int] -> Int (return (+ n 1)))\n(console.log (f 1))" },
  { name: "silent: JS globals", source: '(console.log (Math.max 1 2) (JSON.stringify [1]))' },
];

function baseOptions(stage: "types" | "codegen"): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Warning,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    // Most diagnostics are produced by the type stage; codegen diagnostics (LL01xx) need the backend
    // to actually run, so those probes ask for "codegen".
    stage,
    language: "js",
    frontend: "grammar_v2",
  };
}

interface Emitted {
  code: string;
  severity: string;
  text: string;
}

let TMP_DIR: string;

function diagnosticsOf(probe: Probe, idx: number): Emitted[] {
  const file = path.join(TMP_DIR, `probe_${idx}.lisp`);
  fs.writeFileSync(file, probe.source, "utf8");
  const context = new Context(file, baseOptions(probe.stage ?? "types"));
  try {
    context.process(file);
  } catch {
    // A parse/codegen crash is not what this instrument measures; other suites cover that.
  }
  return context.results.all
    .map((m) => ({ code: String(m.code), severity: String(m.severity), text: m.text }))
    // Sort for stability: parity is a property of the SET of diagnostics, not their emission order.
    .sort((a, b) => (a.code + a.text).localeCompare(b.code + b.text));
}

interface SnapshotEntry {
  probe: string;
  diagnostics: Emitted[];
}

function capture(): SnapshotEntry[] {
  return PROBES.map((p, i) => ({ probe: p.name, diagnostics: diagnosticsOf(p, i) }));
}

function loadSnapshot(): SnapshotEntry[] | null {
  if (!fs.existsSync(SNAPSHOT)) return null;
  return JSON.parse(fs.readFileSync(SNAPSHOT, "utf8"));
}

function diffSnapshot(expected: SnapshotEntry[], actual: SnapshotEntry[]): string[] {
  const diffs: string[] = [];
  const key = (e: SnapshotEntry) => e.probe;
  const exp = new Map(expected.map((e) => [key(e), e]));
  const act = new Map(actual.map((e) => [key(e), e]));

  for (const name of new Set([...exp.keys(), ...act.keys()])) {
    const e = exp.get(name);
    const a = act.get(name);
    if (!e) { diffs.push(`+ probe added: ${name}`); continue; }
    if (!a) { diffs.push(`- probe removed: ${name}`); continue; }
    if (JSON.stringify(e.diagnostics) !== JSON.stringify(a.diagnostics)) {
      diffs.push(
        `~ probe changed: ${name}\n` +
          `    expected: ${JSON.stringify(e.diagnostics)}\n` +
          `    actual:   ${JSON.stringify(a.diagnostics)}`
      );
    }
  }
  return diffs;
}

// ---------------------------------------------------------------------------
// Run.
// ---------------------------------------------------------------------------
function main(): void {
  const { failures } = checkRegistry();

  TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ll-diag-"));
  let snapshotFailures: string[] = [];
  try {
    const actual = capture();

    if (UPDATE || !fs.existsSync(SNAPSHOT)) {
      fs.mkdirSync(path.dirname(SNAPSHOT), { recursive: true });
      fs.writeFileSync(SNAPSHOT, JSON.stringify(actual, null, 2) + "\n", "utf8");
      console.log(`\n=== snapshot ${UPDATE ? "UPDATED" : "CREATED"} ===`);
      console.log(`  ${actual.length} probes -> ${path.relative(process.cwd(), SNAPSHOT)}`);
    } else {
      const expected = loadSnapshot()!;
      const diffs = diffSnapshot(expected, actual);
      console.log("\n=== snapshot ===");
      if (diffs.length === 0) {
        console.log(`  ${actual.length} probes match`);
      } else {
        console.log(`  ${diffs.length} PROBE(S) DIVERGED from the snapshot:`);
        for (const d of diffs) console.log("  " + d);
        console.log("\n  If this change is INTENDED, re-capture with: npm run test:diagnostics -- --update");
        snapshotFailures = diffs;
      }
    }
  } finally {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  }

  const allFailures = [...failures, ...snapshotFailures];
  if (failures.length) {
    console.log("\n=== registry integrity FAILURES ===");
    for (const f of failures) console.log("  " + f);
  }

  if (allFailures.length) {
    console.log(`\nFAIL: ${allFailures.length} problem(s).`);
    process.exit(1);
  }
  console.log("\nPASS");
}

main();

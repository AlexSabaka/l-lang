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
import { Context, CompilerOptions, LogLevel, CompilationLanguage } from "../compiler/Context";
import { RuleSeverity } from "../compiler/rules/RuleBuilder";
import { DIAGNOSTIC_CATEGORIES } from "../compiler/rules/diagnostics";
import { Rules } from "../compiler/rules";

/**
 * The DECLARATIVE rules' codes, read from the rules themselves.
 *
 * This used to be `EXTERNAL_CODES` -- a hand-written array in the registry index -- and it drifted
 * within one phase of its own creation: Qe added a declarative rule wearing LL0029 and did not update
 * the list, so this allocator carried on offering LL0029 as "next free". The next rule would have
 * collided with it, which is the exact failure D38 built the registry to prevent (LL0015-LL0019).
 *
 * A hand-maintained list of codes, sitting beside a registry whose entire purpose is that codes are
 * not hand-maintained, is the same bug wearing a different hat. Derived from `Rules`, it cannot drift:
 * a declarative rule is counted because it EXISTS, not because someone remembered it.
 *
 * Deduped: a code names one diagnostic IDENTITY and may legitimately back several rules (LL0026 is
 * the condition check for both `if` and `when`), so `Rules` has more entries than codes.
 */
const DECLARATIVE_CODES: readonly string[] = [
  ...new Set(Object.values(Rules).map((r: any) => r.code)),
];

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
  const taken = new Set<string>([...owners.keys(), ...DECLARATIVE_CODES]);
  const bands = new Map<string, string[]>(); // "LL02" -> sorted taken codes
  for (const code of taken) {
    const band = code.slice(0, 4); // LL0x
    (bands.get(band) ?? bands.set(band, []).get(band)!).push(code);
  }

  console.log("=== diagnostics registry ===");
  console.log(
    `  registered: ${[...owners.keys()].length} codes across ` +
      `${Object.keys(DIAGNOSTIC_CATEGORIES).length} categories` +
      (DECLARATIVE_CODES.length ? ` (+${DECLARATIVE_CODES.length} external)` : "")
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

  // Surface any overlap: a registry code that ALSO appears in DECLARATIVE_CODES is a migrated diagnostic
  // sharing its number with a declarative rule. Currently empty -- the one such case (LL0015-LL0019) was
  // resolved in D38 by moving the declarative colliders to LL0024-LL0028. Kept as a guard against a new one.
  const external = new Set(DECLARATIVE_CODES);
  const overlap = [...owners.keys()].filter((c) => external.has(c)).sort();
  if (overlap.length) {
    console.log(
      `  NOTE: ${overlap.length} code(s) overloaded with declarative rules (finding): ${overlap.join(", ")}`
    );
  }

  return { failures };
}

/**
 * Codes that are RETIRED, not free.
 *
 * A deleted rule's number does not return to the pool. It is still named by the decision that killed
 * it -- DECISIONS.md carries "`LL0004 ImportHasSymbols` -- deleted", and roadmap.md and STDLIB.md
 * repeat it -- so a NEW rule wearing LL0004 would make all of that history read as documentation of
 * the wrong diagnostic. Whoever greps the code next gets a tombstone and a live rule and no way to
 * tell which is which.
 *
 * This list exists because the allocator offered LL0004 as "next free" while writing Qe. An allocator
 * whose entire job is finding a free spot must not hand out a spot that is occupied by history.
 */
const RETIRED_CODES: ReadonlySet<string> = new Set([
  "LL0004", // ImportHasSymbols -- deleted in Sc3: dead, and it encoded a false invariant.
  "LL0103", // ReturnInExpressionPosition -- retired with the HIR cut (D45); the tombstone lived only
            // in a CodegenDiagnostics comment, so the allocator kept offering it as next-free.
]);

/** First unused LLxxNN in a band (e.g. band "LL02" -> LL0200..LL0299). */
function nextFree(band: string, taken: Set<string>): string {
  for (let n = 0; n < 100; n++) {
    const code = `${band}${n.toString().padStart(2, "0")}`;
    // LL0000 is not allocatable. A code of all zeros reads as a SENTINEL -- "no code", "unset" --
    // rather than as a diagnostic, and it is the first thing this allocator offered for the 00xx
    // band because it scans from zero and nothing had ever taken slot 00 there. Only THIS code is
    // skipped, not every band's 00 slot: LL0300 is a real, allocated code.
    if (code === "LL0000") continue;
    if (RETIRED_CODES.has(code)) continue;
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
  /** Backend, for a backend-specific codegen diagnostic (the C backend's LL0105-07). Defaults to js. */
  language?: CompilationLanguage;
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
    // D94. A LOOP'S VALUE IS `Nil`, AND THE TYPE IS WHAT MAKES THIS A COMPILE ERROR.
    //
    // These forms used to land in `inferExpressionType`'s `default` arm as Unknown, and Unknown is
    // what let the value flow: this program passed the type checker and panicked at RUN time on both
    // backends (`TypeError: expected a number` on C, a crash inside the shim on JS). The `for :each`
    // variant was worse -- it printed `1`, a silent wrong answer.
    //
    // No new diagnostic was needed. LL0204 was always able to refuse this; nothing had ever told it
    // what the left operand was.
    name: "LL0204 arithmetic on a loop's value",
    source: "(mut i 0)\n(console.log (+ (while (< i 3) ((i := (+ i 1)))) 1))",
  },
  {
    name: "LL0204 arithmetic on an assignment's value",
    source: "(mut z 0)\n(console.log (+ (z := 5) 1))",
  },
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
  // D23'S BLOCK-SCOPE INVARIANT, AND THIS PROBE IS ITS PIN -- named properly as of D105.
  //
  // LL0212 is checked in `visitList`, not `visitProgram`. Two SIBLING top-level forms are therefore
  // two lists and NOT a duplicate; the same two inside one block are. This probe writes its source
  // verbatim (no wrapper), so it is the sibling spelling, and its recorded value is the EMPTY
  // diagnostic list. Move the check to `visitProgram` and this snapshot flips from `[]` to LL0212.
  //
  // It has been that pin by accident and under a name that said the opposite -- "LL0212 duplicate
  // declaration", recording zero diagnostics. D23 credited `test:repl` instead, and D105 retired
  // that suite; a pin nobody can identify does not survive the removal of the thing it was
  // mistakenly attributed to. The block-scoped half is in `test/type-errors.ts`, whose harness wraps.
  { name: "LL0212 is NOT raised across sibling top-level forms (D23)", source: "(let d 1)\n(let d 2)" },
  { name: "LL0221 for-each over non-iterable", source: "(for :each x :from 5 :then (console.log x))" },
  { name: "LL0222 yield outside :gen", source: "(fn f [] -> Int (yield 1))" },
  {
    name: "LL0223 :gen returns a value",
    source: "(import \"std/iter\")\n(fn :gen g [] -> Iterator<Int> (yield 1) (return 5))",
  },
  { name: "LL0224 :gen wrong return type", source: "(fn :gen g [] -> Int (yield 1))" },
  {
    name: "LL0225 :gen yield type mismatch",
    source: '(import "std/iter")\n(fn :gen g [] -> Iterator<Int> (yield "s"))',
  },
  { name: "LL0226 :gen never yields", source: "(import \"std/iter\")\n(fn :gen g [] -> Iterator<Int> (return))" },
  {
    name: "LL0237 valueless (yield)",
    source: '(import "std/iter")\n(fn :gen g [] -> Iterator<Int> (yield))',
  },
  {
    name: "LL0238 :gen with a nullable element type",
    source: '(import "std/iter")\n(fn :gen g [] -> Iterator<Int?> (yield 1))',
  },
  {
    name: "LL0239 yield inside a protected region",
    source:
      '(import "std/iter")\n' +
      "(fn :gen g [] -> Iterator<Int> (try ((yield 1)) catch e :of Error (console.log 0)))",
  },
  { name: "LL0227 await outside :async", source: "(fn f [] -> Int (await 1))" },
  { name: "LL0228 :async wrong return type", source: "(fn :async f [] -> Int 1)" },
  { name: "LL0229 :extension without receiver", source: "(fn :extension foo [] -> Int 1)" },
  {
    name: "LL0230 lazy op on a bare array",
    source: '(import "std/iter/linq")\n(let xs [1 2 3])\n(console.log (xs.take 2))',
  },

  // --- syntax/modifier band (LL0015-LL0019, LL0023), emitted by SyntaxRulesAstVisitor ---
  { name: "LL0015 unknown modifier", source: "(fn :zzz foo [] -> Int 1)" },
  { name: "LL0016 reserved native modifier", source: "(fn :gc foo [] -> Int 1)" },
  {
    name: "LL0017 duplicate for clause",
    source: "(let xs [1 2])\n(let ys [3 4])\n(for :each x :from xs :from ys :then (console.log x))",
  },
  { name: "LL0018 missing for clause", source: "(for :each x :then (console.log x))" },
  {
    // D102 RE-AIMED THIS. `defmacro` is implemented now, so a well-formed one is CONSUMED by the token
    // expander and never reaches the parser. What still reaches it is a form the expander could not
    // READ -- it matches brackets rather than parsing, because a file using a macro may not parse
    // until after expansion, so anything without the `(defmacro name [params] body…)` shape is
    // skipped. `(defmacro)` with no name is exactly that.
    name: "LL0023 a defmacro the expander cannot read",
    source: "(defmacro)",
  },
  {
    name: "LL0029 mid-list rest is not trailing",
    source: "(match [1 2 3] { [a ...mid z] => (console.log a) _ => (console.log 0) })",
  },
  {
    // Vc/AF-007: this code was UNREACHABLE until the `!x.filter` test was corrected -- LL0008 had
    // never fired on any input. Pinned so it cannot quietly die again.
    name: "LL0008 two default catch blocks",
    source: "(try ((throw (Error \"x\"))) catch a ((console.log 1)) catch b ((console.log 2)))",
  },

  // --- codegen band (LL0100-LL0104; LL0103 retired with the HIR cut, D45): the backend must actually run, so stage "codegen" ---
  {
    // Zc. `:of` on a type the runtime cannot test. It used to emit `__ll_is_type(v, "Any")` and match
    // every value in the language; it refuses now.
    //
    // A TUPLE, not the union this probe first used: Zd gave unions a real test (an `||` of their
    // members), so the union stopped being a diagnostic and the snapshot caught it -- which is the
    // snapshot doing its job. What has no runtime test is what belongs here.
    name: "LL0104 :of on an untestable type",
    source: "(let x 5) (console.log (if (x :of [Int String]) 1 0))",
    stage: "codegen",
  },
  { name: "LL0102 non-name in binding position", source: "(let [1] [5])", stage: "codegen" },
  {
    // D94. A DECLARATION in a value slot. This is what is left of `asExpression`'s bare
    // `throw new Error` once the named-`fn` case stopped being an error at all (it emits a
    // FunctionExpression now and yields the function, matching the C reference). The throw handed the
    // user a raw Node stack trace, which is a defect regardless of what was being refused.
    //
    // The C backend refuses the same program as ELL0106, so the two agree that a declaration is not a
    // value -- they only differ in which net catches it.
    name: "LL0109 a declaration used as a value",
    source: "(let x (defclass C (let :ctor a <- Int)))",
    stage: "codegen",
  },
  {
    name: "LL0102 constructor default before required",
    source: "(defstruct S (let :ctor a <- Int 0) (let :ctor b <- Int))",
    stage: "codegen",
  },

  // --- the `defsyntax` tier's refusals (LL0038-LL0042, D95). All syntax-band: the expansion stage
  //     runs between parse and syntax, so a handler that fails has to be reported there or not at
  //     all -- nothing downstream models a `syntax-def`.
  {
    name: "LL0038 a defsyntax declared twice",
    source: "(defsyntax dup [x] `(a ~x))\n(defsyntax dup [x] `(b ~x))\n(dup 1)",
  },
  {
    name: "LL0039 a defsyntax called with the wrong number of forms",
    source: "(defsyntax unless [c body] `(if ~c nil ~body))\n(unless 1)",
  },
  {
    // Expands into its own form: no fixed point. The depth budget is what makes this a diagnostic
    // rather than a compiler that never returns.
    name: "LL0040 a defsyntax that expands into itself",
    source: "(defsyntax loopy [x] `(loopy ~x))\n(loopy 1)",
  },
  {
    // The handler RAN and raised. Carries the interpreter's own message, so the diagnostic names the
    // construct rather than saying "expansion failed" -- a handler may use the comptime SUBSET, and
    // `while` is outside it.
    name: "LL0041 a defsyntax whose body leaves the comptime subset",
    source: "(defsyntax g [x] (while true 1))\n(g 1)",
  },
  {
    name: "LL0042 a defsyntax that answers a value instead of a form",
    source: "(defsyntax five [x] 5)\n(console.log (five 1))",
  },
  {
    // Both tiers are BUILT now (D95-a `defsyntax`, D102 `defmacro`). A well-formed `defmacro` with no
    // call site is consumed silently -- the declaration has done its job and nothing downstream models
    // it -- so this probe asserts SILENCE, which is what "the tier exists" looks like from here.
    name: "silent: a well-formed defmacro is consumed, not refused",
    source: "(defmacro m [x] (list x))",
  },
  {
    // D96. `~x` is a HOLE and needs a template around it. Before the rule it reached CODEGEN and
    // reported `ELL0106 Cannot generate C for 'unquote'` -- telling the author about a backend gap
    // when what they did was use a template operator outside a template.
    name: "LL0110 an unquote outside a quasiquote",
    source: "(let x 1)\n(console.log ~x)",
  },
  {
    // M3. A quoted form is now a legal `:comptime` ARGUMENT (it is a compile-time constant in exactly
    // the sense LL0099 means -- quote does not evaluate its operand, so there is nothing to fail). A
    // form's `_parent` is still refused, and deliberately: it is CYCLIC, and reading it would let a
    // handler walk out of its own form into the enclosing program.
    name: "LL0099 a form's _parent is not readable at compile time",
    source: "(fn :comptime esc [f <- Any] -> Any (return f._parent))\n(console.log (esc '(+ 1 2)))",
  },
  {
    // ...and the literal rule itself is unchanged for everything that is not a constant.
    name: "LL0099 a mutable binding is still not a comptime argument",
    source: "(fn :comptime f [x <- Int] -> Int (return x))\n(mut n 5)\n(console.log (f n))",
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
  // D89's positive half. Before it, this was `LL0203 expected Ring, got Int` -- no primitive conformed
  // to any interface at all -- which made a numeric protocol useless for the numbers.
  {
    name: "silent: Ring accepts a primitive",
    source:
      "(definterface Ring<T> (fn :operator + [other <- T] -> T) (fn :operator * [other <- T] -> T))\n" +
      "(fn f [x <- Ring] -> Int (return 1))\n(console.log (f 3) (f 2.5))",
  },
  // D89/R2's positive half, and the guard on the injection: a homogeneous matrix says nothing, and
  // in particular the demand-injected `std/core/protocols` must not make LL0245 fire on a file that
  // merely wrote a matrix. The literal implies its own import; only a NAME warns.
  { name: "silent: a homogeneous matrix", source: "(console.log [1 2 | 3 4])" },
  { name: "silent: a matrix of Rational", source: "(console.log [1/2 1/3 | 1/4 1/5])" },
  // D90/R3: two units with the SAME dimension and different names are mutually assignable. The guard
  // on the other side is `LL0200 a Meter is not a Speed` above.
  {
    name: "silent: same dimension, different name",
    source:
      "(deftype :unit Meter <- Real)\n(deftype :unit Second <- Real)\n" +
      "(deftype Speed <- Real :satisfies (/ Meter Second))\n" +
      "(deftype Velocity <- Real :satisfies (/ Meter Second))\n" +
      "(let v <- Speed 5.0)\n(let u <- Velocity v)\n(console.log u)",
  },
  // D90/R4: a DIMENSIONLESS factor is the identity for `*`/`/`. Without it a measurement could not be
  // scaled at all, since `2.0` has no unit and never could.
  {
    name: "silent: scaling a unit by a plain number",
    source:
      "(deftype :unit Meter <- Real)\n(let d <- Meter 10.0)\n" +
      "(let a <- Meter (* d 2.0))\n(let b <- Meter (/ d 2.0))\n(console.log a b)",
  },
  // The SCOPE of the whole dimension system: a merely REFINED newtype is a bounded VALUE, not a
  // measurement, and arithmetic on it is untouched. This probe is the reduced form of the five corpus
  // files that the first (shape-based) ruling broke -- three of them on lines labelled "widened:".
  {
    name: "silent: arithmetic on a refined newtype is not dimensional",
    source:
      "(deftype uint8 <- Int :satisfies (0..255))\n(deftype Level <- Int :satisfies (1 ..))\n" +
      "(let b <- uint8 200)\n(let w <- uint8 (+ b 55))\n(let l <- Level 3)\n" +
      "(console.log w (+ l 1) (+ b l))",
  },
  // And the algebra REDUCES: `(/ (* Meter Second) Second)` is `Meter`, so a unit is its normal form
  // rather than its source text.
  {
    name: "silent: a dimension that reduces to a base unit",
    source:
      "(deftype :unit Meter <- Real)\n(deftype :unit Second <- Real)\n" +
      "(deftype M2 <- Real :satisfies (/ (* Meter Second) Second))\n" +
      "(let d <- Meter 3.0)\n(let m <- M2 d)\n(console.log m)",
  },

  // --- C backend refusals (LL0105 / LL0107): the probe's honest "not modeled" answers. These
  //     type-check clean (and compile on JS) but refuse on the C backend, so they run language:"c"
  //     at codegen. The generator needs std/iter for Iterator<T>/yield to type-check. ---
  // A top-level `:gen` USED to be the probe here. Phase G4c lowered it, so the probe was moved to
  // the coroutine surface that is still refused rather than deleted -- LL0105 must stay reachable
  // and located, and D60 keeps `:async` C-refused deliberately (l-lang owns await ordering; there is
  // no native lowering to constrain). A nested or lambda `:gen` also still refuses, under ledger
  // §11.2/§11.3's own pre-existing defects.
  {
    name: "LL0105 C backend refuses an async function",
    // No return ANNOTATION: `-> Int` on an `:async` is LL0228 at the checker, so the probe would
    // never reach codegen and would have snapshotted the wrong diagnostic entirely.
    source: "(fn :async fetch-it [] (return 1))\n(console.log 0)",
    stage: "codegen", language: "c",
  },
  {
    name: "LL0107 C backend refuses an unresolvable host global",
    source: "(console.log (Symbol))",
    stage: "codegen", language: "c",
  },
  // LL0106 from P3 rather than P1 -- the EMITTER's refusals. Both of these used to escape as an
  // uncaught `throw new Error("C emit: no cast ...")`, i.e. a TypeScript stack trace pointing at
  // `EmitCirToC.ts:977` instead of a diagnostic pointing at the user's source. They are pinned HERE
  // and not in the corpus because both COMPILE AND RUN on JS, so there is no manifest status that
  // fits: `negative` asserts failure on both backends, `xfail` asserts nothing at all.
  // D88 N4: a standalone `..` is the span/wildcard, and spans are not implemented. Reported at the
  // syntax stage, so both backends agree.
  {
    name: "LL0034 a spaced `..` is a span, not a range",
    source: "(for :each i :from (0 .. 3) :then (console.log i))",
    stage: "types",
  },
  // D93: `...` binds by adjacency for the same reason `..` does. Both spellings, because the operand
  // kind is irrelevant -- adjacency is about the `...` and what immediately follows it.
  {
    name: "LL0037 a spaced `...` is not a spread (call position)",
    source: "((fn add3 [a <- Int b <- Int c <- Int] -> Int (return (+ a b c))) (let xs [1 2 3]) (add3 ... xs))",
    stage: "types",
  },
  {
    name: "LL0037 a spaced `...` is not a spread (vector position)",
    source: "((let xs [1 2 3]) (let v [0 ... xs]))",
    stage: "types",
  },
  // D88 N3: the GUARD on promotion -- it adds assignability through DECLARED conversions and invents
  // none. There is no `String -> Int` defcast, so this stays an error.
  {
    name: "LL0204 promotion does not invent a conversion",
    source: '(console.log (- 3 "s"))',
    stage: "types",
  },
  // D88 N2: a radix literal is an Int, so a bad assignment is caught. It inferred Unknown before --
  // assignable in BOTH directions -- so this compiled clean. The literal did not merely lack a type;
  // it turned checking off at its use site.
  {
    name: "LL0200 a hex literal is an Int, not Unknown",
    source: "(let h <- String 0xFF)\n(console.log h)",
    stage: "types",
  },
  // LL0245 (D88): the name resolved only because a literal elsewhere pulled its module in. Pinned
  // HERE and not in the corpus because it is a WARNING -- the program compiles and runs, so no corpus
  // status asserts it. (It is also invisible through `run` today, which prints diagnostics only when
  // `hasErrors`; noted in the roadmap, and not fixed here because that file has uncommitted work.)
  {
    name: "LL0245 a syntax module's name used without importing it",
    source: '(console.log 1/2)\n(console.log (Rational 3 4))',
    stage: "types",
  },
  // The GUARD on the ruling: a literal alone implies its import and must warn about NOTHING.
  {
    name: "LL0245 does not fire for a literal alone",
    source: '(console.log 1/2)',
    stage: "types",
  },
  // LL0244 (D85): a zero divisor the compiler can SEE. Reported by the type stage, so it fires on
  // both backends -- the probe runs the default js.
  {
    name: "LL0244 integer division by a literal zero",
    source: "(console.log (/ 1 0))",
    stage: "types",
  },
  {
    name: "LL0244 integer modulo by a literal zero",
    source: "(console.log (% 1 0))",
    stage: "types",
  },
  // D89: a PRIMITIVE answers an OPERATOR-named interface member and nothing else. The interface is
  // declared inline rather than imported from `std/core/protocols` so these stay dep-free like their
  // neighbours; the stdlib declaration is pinned by `80-adversarial/ring_protocol.lisp`.
  {
    name: "LL0203 Ring refuses a String (it has + and no *)",
    source:
      "(definterface Ring<T> (fn :operator + [other <- T] -> T) (fn :operator * [other <- T] -> T))\n" +
      '(fn f [x <- Ring] -> Int (return 1))\n(console.log (f "s"))',
    stage: "types",
  },
  // The SCOPE of the widening, and the reason it is keyed on `isOperatorName`: a NAMED member is not
  // synthesized, so `Int` still fails an interface that asks for a method. If this ever goes silent,
  // "primitives conform to operator protocols" has quietly become "primitives conform to anything".
  {
    name: "LL0203 a named-member interface still refuses Int",
    source:
      "(definterface Comparable<T> (fn compare-to [other <- T] -> Int))\n" +
      "(fn f [x <- Comparable] -> Int (return 1))\n(console.log (f 3))",
    stage: "types",
  },
  // And a comparison-only interface must NOT be satisfiable by synthesis: `getBinaryOpType` answers
  // Boolean for every `<` whatever the operands, so an operator that cannot say no is not evidence.
  {
    name: "LL0203 a comparison-member interface is not answered by synthesis",
    source:
      "(definterface Ordered<T> (fn :operator < [other <- T] -> Boolean))\n" +
      "(fn f [x <- Ordered] -> Int (return 1))\n(console.log (f 3))",
    stage: "types",
  },
  // D89/R2: a matrix's cells share ONE Ring. `Ring` reaches these probes by demand-injection on the
  // `matrix` node, so they need no import -- which is itself part of what is pinned.
  {
    name: "LL0246 matrix cells of two different types",
    source: '(let m [1 "x" | 2 3])\n(console.log m)',
    stage: "types",
  },
  // Assignability was the obvious choice for "share" and is measurably wrong: D88's promotion would
  // call this a Rational matrix while the emitted cell still holds a raw `1`. The remedy is `1/1`.
  {
    name: "LL0246 matrix cells that would need a promotion",
    source: "(let m [1 1/2 | 2 3])\n(console.log m)",
    stage: "types",
  },
  {
    name: "LL0246 a matrix of a type that is not a Ring",
    source: '(let m ["a" "b" | "c" "d"])\n(console.log m)',
    stage: "types",
  },
  // THE REGRESSION THAT MOTIVATED THE ARM. A matrix literal inferred Unknown -- assignable both ways --
  // so this compiled clean. It is an ordinary type mismatch now.
  {
    name: "LL0200 a matrix literal is Int[][], not Unknown",
    source: "(let s <- String [1 2 | 3 4])\n(console.log s)",
    stage: "types",
  },
  // D90/R3: a DIMENSION refinement, and the two ways it fails to resolve. Reported at the DECLARATION
  // and in the second pass, so a derived unit may name a type declared later in the file.
  {
    name: "LL0248 a dimension names something that is not a unit",
    source:
      "(deftype :unit Meter <- Real)\n" +
      "(deftype Speed <- Real :satisfies (/ Meter Metre))\n(console.log 1)",
    stage: "types",
  },
  {
    name: "LL0248 a circular dimension",
    source:
      "(deftype :unit Meter <- Real)\n" +
      "(deftype Loopy <- Real :satisfies (/ Loopy Meter))\n(console.log 1)",
    stage: "types",
  },
  // LL0249 -- `:implements` naming nothing reachable. The sibling of LL0209: that one asks whether
  // the claim is TRUE, this one whether there is anything to claim. Both spellings are probed
  // because `checkDeclaredInterfaces` was typed for class AND struct and wired only for class, so a
  // struct's `:implements` was unverified entirely -- LL0209 included.
  {
    name: "LL0249 a class :implements something that does not exist",
    source: "(defclass K :implements Bogusable<Int> (let :ctor v <- Int))\n(console.log 1)",
    stage: "types",
  },
  {
    name: "LL0249 a struct :implements something that does not exist",
    source: "(defstruct S :implements Bogusable<Int> (mut :ctor v <- Int))\n(console.log 1)",
    stage: "types",
  },
  // The GUARD on the pair: a struct that claims a real interface and implements none of it must be
  // LL0209, not LL0249 -- and before this round it was neither.
  {
    name: "LL0209 a STRUCT that claims an interface and implements none of it",
    source:
      '(import "std/iter")\n(defstruct Liar :implements Iterator<Int> (mut :ctor v <- Int))\n(console.log 1)',
    stage: "types",
  },
  // The boundary is still nominal-by-DIMENSION: `Meter` is not `Meter/Second`, whatever it is called.
  {
    name: "LL0200 a Meter is not a Speed",
    source:
      "(deftype :unit Meter <- Real)\n(deftype :unit Second <- Real)\n" +
      "(deftype Speed <- Real :satisfies (/ Meter Second))\n" +
      "(let d <- Meter 10.0)\n(let bad <- Speed d)\n(console.log bad)",
    stage: "types",
  },
  // D90/R4: `+`/`-` may not cross dimensions, and a plain Real is DIMENSIONLESS rather than unknown.
  {
    name: "LL0247 adding two different dimensions",
    source:
      "(deftype :unit Meter <- Real)\n(deftype :unit Second <- Real)\n" +
      "(let d <- Meter 10.0)\n(let t <- Second 2.0)\n(console.log (+ d t))",
    stage: "types",
  },
  {
    name: "LL0247 adding a dimensionless literal to a unit",
    source:
      "(deftype :unit Meter <- Real)\n" +
      "(let d <- Meter 10.0)\n(console.log (+ d 2.0))",
    stage: "types",
  },
  // Composition is CHECKED, not merely permitted: `(* d t)` is Meter*Second and a Speed is Meter/Second.
  {
    name: "LL0200 a composed dimension must still match",
    source:
      "(deftype :unit Meter <- Real)\n(deftype :unit Second <- Real)\n" +
      "(deftype Speed <- Real :satisfies (/ Meter Second))\n" +
      "(let d <- Meter 10.0)\n(let t <- Second 2.0)\n(let bad <- Speed (* d t))\n(console.log bad)",
    stage: "types",
  },
  {
    name: "LL0106 C emitter refuses a method bound as a value",
    source:
      "(defclass Doubler (fn apply [x <- Int] -> Int (return (* x 2))))\n" +
      "(let d (new Doubler))\n(let f d.apply)\n(console.log (f 5))",
    stage: "codegen", language: "c",
  },
  {
    name: "LL0106 C emitter refuses an :implicit defcast at an arg-coercion site",
    source:
      "(defclass Celsius (let :ctor degrees <- Real))\n" +
      "(defcast :implicit [c <- Celsius] -> Real c.degrees)\n" +
      "(fn ident [x <- Real] -> Real x)\n(let t (Celsius 21.0))\n(console.log \"arg:\" (ident t))",
    stage: "codegen", language: "c",
  },
];

function baseOptions(stage: "types" | "codegen", language: CompilationLanguage = "js"): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Warning,
    logger: () => {},
    includeRuntimeShim: true,
    stdout: false,
    // Most diagnostics are produced by the type stage; codegen diagnostics (LL01xx) need the backend
    // to actually run, so those probes ask for "codegen".
    stage,
    language,
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
  const context = new Context(file, baseOptions(probe.stage ?? "types", probe.language ?? "js"));
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

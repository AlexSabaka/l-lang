#!/usr/bin/env ts-node
/**
 * The measurement harness for P4 -- making the type checker able to say no.
 *
 * Today the type system CANNOT fail a build: its six real checks call
 * `context.log(LogLevel.Error, ...)`, which touches the logger and nothing else, and its only
 * `results.add` lives in a class whose dispatch can never resolve a method name. So a "type error"
 * is printed and forgotten, and codegen runs anyway.
 *
 * Arming those six checks as-is would emit 86 errors across 26 files, 19 of them currently-PASSING
 * tests. So the false positives have to die first -- and that only works if the count is
 * measurable at every step. Hence this.
 *
 * It counts BOTH channels, so the number stays comparable across the moment we arm the checker:
 *   - "logged"   -- LogLevel.Error text matching a known type-check message (the pre-arming path)
 *   - "reported" -- a results.add entry with an LL02xx code (the post-arming path)
 *
 * Usage:
 *   npm run test:type-errors            # corpus count + negative tests
 *   npm run test:type-errors -- --list  # also list every offending file and message
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";
import { MANIFEST } from "./manifest";

const EXAMPLES = path.resolve(__dirname, "../../examples");
const LIST = process.argv.includes("--list");

/**
 * The six checks that exist in InferAndCheckPass today. Pre-arming they only reach the logger, so
 * they can only be recognised by their text. Post-arming they carry an LL02xx code and this list
 * becomes redundant -- keep it anyway, so a regression back to log-only is visible rather than
 * silently reading as "zero type errors".
 */
const TYPE_ERROR_TEXT =
  /Type mismatch|If condition must be|Argument \d+ type mismatch|Invalid unary operator|Invalid binary operator/;

/** Errors raised by the type stage, whichever channel they took. */
interface Diagnostic {
  channel: "logged" | "reported";
  code?: string;
  text: string;
}

function baseOptions(collect: (d: Diagnostic) => void): CompilerOptions {
  return {
    minimumLogLevel: LogLevel.Warning,
    logger: (msg: any) => {
      const text = String(msg);
      // Context.log prefixes with the level; the type checks are the only things emitting these.
      if (TYPE_ERROR_TEXT.test(text)) {
        collect({ channel: "logged", text: text.split("\n").pop()!.trim() });
      }
    },
    includeRuntimeShim: true,
    stdout: false,
    stage: "types", // stop before codegen: we are measuring the type stage, not the backend
    language: "js",
    frontend: "grammar_v2",
  };
}

/** Every type diagnostic a single source produces, from both channels. */
function diagnose(file: string): Diagnostic[] {
  const found: Diagnostic[] = [];
  const context = new Context(file, baseOptions((d) => found.push(d)));

  try {
    context.process(file);
  } catch {
    // A parse/codegen crash is not what this harness measures; other suites cover that.
  }

  for (const m of context.results.all) {
    if (String(m.code).startsWith("LL02")) {
      found.push({ channel: "reported", code: m.code, text: flatten(m.message) });
    }
  }

  return found;
}

/**
 * The WHOLE message, flattened -- not `.split("\n").pop()`, which kept only the LAST line and was
 * usually the empty one, so every diagnostic printed as a blank string.
 *
 * The identical bug was found and fixed in the codegen harness in D9e. It matters more here: this is
 * the instrument P6 is judged on, and a measurement you cannot read is not a measurement.
 */
function flatten(message: unknown): string {
  return String(message)
    .split("\n")
    .map((s) => s.trim())
    .filter(Boolean)
    .join(" ");
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (e.name.endsWith(".lisp")) out.push(p);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Part 1 -- the corpus count. This is the number the phase is judged on.
// ---------------------------------------------------------------------------
function measureCorpus(): { onTests: number; total: number; files: number } {
  let total = 0;
  let onTests = 0;
  let files = 0;
  const offenders: string[] = [];

  for (const file of walk(EXAMPLES).sort()) {
    const rel = path.relative(EXAMPLES, file);
    const status = MANIFEST[rel]?.status ?? "test";
    const diags = diagnose(file);
    if (diags.length === 0) continue;

    files++;
    total += diags.length;
    // Only a currently-PASSING test can be broken by arming the checker. An xfail/fixture already
    // fails, so a diagnostic there costs nothing -- and may well be correct.
    if (status === "test") {
      onTests += diags.length;
      offenders.push(`  ${rel}  [${status}]  ${diags.length}`);
      if (LIST) for (const d of diags) offenders.push(`      ${d.channel}${d.code ? " " + d.code : ""}: ${d.text.slice(0, 96)}`);
    } else if (LIST) {
      offenders.push(`  ${rel}  [${status}]  ${diags.length}`);
    }
  }

  console.log("=== corpus: type diagnostics ===");
  console.log(`  total across all examples : ${total}  (in ${files} files)`);
  console.log(`  on currently-PASSING tests: ${onTests}   <-- must be 0 before arming`);
  if (offenders.length) {
    console.log("\n--- files ---");
    console.log(offenders.join("\n"));
  }

  return { onTests, total, files };
}

// ---------------------------------------------------------------------------
// Part 2 -- negative tests. A checker that reports nothing is trivially "correct"; these stop us
// declaring victory by simply going quiet.
// ---------------------------------------------------------------------------
interface Case {
  name: string;
  source: string;
  /** A diagnostic must match this. */
  expect?: RegExp;
  /** ...or there must be NO diagnostic at all. */
  silent?: boolean;
  /** Not yet implemented -- reported, not failed, so the harness tracks progress honestly. */
  pending?: boolean;
}

/** A two-level hierarchy, shared by the P7d subtyping and variance cases. */
const ANIMALS = `(defclass Animal (fn speak [] -> String (return "...")))
(defclass Dog :extends Animal (fn speak [] -> String (return "Woof")))`;

/** A covariant producer and one implementation of it. */
const PRODUCER = `(definterface Producer<:out T> (fn produce [] -> T))
(defclass DogProducer :implements Producer<Dog> (fn produce [] -> Dog (return (Dog))))`;

const CASES: Case[] = [
  // --- must be silent: these are correct programs, or JS interop the checker has no business
  // judging. Every one of these is a false positive we are killing. ---
  { name: "JS global method call", source: '(console.log (Math.log 4))', silent: true },
  { name: "string method call", source: '(let s "abc")\n(console.log (s.indexOf "b"))', silent: true },
  { name: "member call on a let", source: '(let t "a,b")\n(console.log (t.split ","))', silent: true },
  { name: "new expression", source: "(defclass Box (let :ctor v <- Int 0))\n(let b (new Box 5))", silent: true },
  { name: "arithmetic on annotated ints", source: "(let a <- Int 1)\n(let b <- Int 2)\n(console.log (+ a b))", silent: true },
  { name: "unannotated arithmetic", source: "(let a 1)\n(console.log (+ a 2))", silent: true },

  // --- must be caught: these are genuinely wrong. ---
  { name: "type mismatch on let", source: '(let x <- Int "str")', expect: /Type mismatch|LL0200/ },
  { name: "if condition not Boolean", source: '(if "str" 1 2)', expect: /If condition|LL0201/ },

  // --- P4c ---
  { name: "arity: too many args", source: "(fn f [a <- Int] -> Int a)\n(f 1 2 3)", expect: /LL0211/ },
  { name: "arity: too few args", source: "(fn f [a <- Int b <- Int] -> Int a)\n(f 1)", expect: /LL0211/ },
  { name: "variadic call is NOT flagged", source: '(fn p [m <- String ...rest] -> Void (console.log m))\n(p "a" 1 2 3)', silent: true },
  { name: "compound assignment", source: '(mut x <- Int 1)\n(x := "str")', expect: /LL0202/ },
  { name: "return type", source: '(fn f [] -> Int (return "str"))', expect: /LL0213/ },
  { name: "duplicate declaration", source: "(let d 1)\n(let d 2)", expect: /LL0212/, pending: true },

  // --- LL0210: unresolved identifiers. Unblocked by P6's scope-aware resolution. ---
  { name: "unresolved identifier", source: "(undefined-fn 1)", expect: /LL0210/ },
  { name: "unresolved in a loop body", source: "(let xs [1 2])\n(for :each x :from xs :then (bogus-fn x))", expect: /LL0210/ },
  { name: "unresolved in a match arm", source: '(let v 1)\n(match v { 1 => (bogus-fn v) _ => 0 })', expect: /LL0210/ },

  // ...and the things it must NOT flag. Each of these was a false positive on the way here.
  { name: "a parameter resolves", source: "(fn f [n <- Int] -> Int (return (+ n 1)))\n(console.log (f 1))", silent: true },
  { name: "a local let resolves", source: "(fn f [] -> Int (let k 2) (return k))\n(console.log (f))", silent: true },
  { name: "a for-each binding resolves", source: "(let xs [1 2])\n(for :each x :from xs :then (console.log x))", silent: true },
  { name: "a catch binding resolves", source: '(try ((throw (Error "x"))) catch e :of Error ((console.log e)))', silent: true },
  { name: "a match binding resolves", source: "(let v [1 2])\n(match v { [a b] => (console.log a b) _ => 0 })", silent: true },
  { name: "map KEYS are not references", source: '(let m { :name "x" :age 1 })\n(console.log m)', silent: true },
  { name: "JS globals are not flagged", source: '(console.log (Math.max 1 2) (JSON.stringify [1]))', silent: true },
  { name: "a member call on a local", source: '(let s "a,b")\n(console.log (s.split ","))', silent: true },

  // --- P7d: class subtyping. `TypeChecker` said `// TODO: Class inheritance checking` and
  // isAssignable(Dog, Animal) was FALSE, so a subclass could not be passed where its parent was
  // expected. Variance is decoration until this works. ---
  {
    name: "a subclass IS its parent",
    source: `${ANIMALS}
(fn feed [a <- Animal] -> Void (console.log "fed"))
(let d <- Dog (Dog))
(feed d)`,
    silent: true,
  },
  {
    name: "a parent is NOT its subclass",
    source: `${ANIMALS}
(fn walk [d <- Dog] -> Void (console.log "walked"))
(let a <- Animal (Animal))
(walk a)`,
    expect: /LL0203/,
  },
  {
    name: "a subclass IS its grandparent",
    source: `${ANIMALS}
(defclass Puppy :extends Dog (fn speak [] -> String (return "Yip")))
(fn feed [a <- Animal] -> Void (console.log "fed"))
(let p <- Puppy (Puppy))
(feed p)`,
    silent: true,
  },

  // --- P7d: use-site variance. ---
  {
    name: "covariant :out accepts a subtype",
    source: `${ANIMALS}
${PRODUCER}
(fn use [p <- Producer<Animal>] -> Void (console.log "used"))
(let dp <- Producer<Dog> (DogProducer))
(use dp)`,
    silent: true,
  },
  {
    name: "a class implementing Producer<Dog> IS a Producer<Animal>",
    source: `${ANIMALS}
${PRODUCER}
(fn use [p <- Producer<Animal>] -> Void (console.log "used"))
(let dp <- DogProducer (DogProducer))
(use dp)`,
    silent: true,
  },
  {
    name: "covariant :out still REJECTS a supertype",
    source: `${ANIMALS}
${PRODUCER}
(defclass AnimalProducer :implements Producer<Animal> (fn produce [] -> Animal (return (Animal))))
(fn use [p <- Producer<Dog>] -> Void (console.log "used"))
(let ap <- Producer<Animal> (AnimalProducer))
(use ap)`,
    expect: /LL0203/,
  },
  {
    name: "an INVARIANT generic rejects a subtype",
    source: `${ANIMALS}
(defclass Box<T> (mut :ctor v <- T))
(fn take [b <- Box<Animal>] -> Void (console.log "took"))
(let bd <- Box<Dog> (Box (Dog)))
(take bd)`,
    expect: /LL0203/,
  },

  // --- P6: the checker can see a LOCAL and a PARAMETER. ---
  //
  // Every one of these is silent today, and the reason is always the same: an inferred type for a
  // non-top-level name is written through a FLAT lookup (`bindType` -> `resolveSymbol(name)`), which
  // cannot see a child scope. The type is dropped -- and where a top-level homonym exists, it is
  // written onto THAT symbol instead.
  {
    name: "P6: a nested let's annotation is real",
    source: '(fn f [] -> Int (let x <- Int "str") (return 1))',
    expect: /LL0200/,
  },
  {
    name: "P6: a class field's annotation is real",
    source: "(defclass C (let :private v <- String nil))",
    expect: /LL0200/,
  },
  {
    name: "P6: a parameter's type is real",
    source: "(fn f [s <- String] -> Int (return (- s 1)))",
    expect: /LL0204/,
  },
  {
    name: "P6: an argument typed from a local",
    source: '(fn g [n <- Int] -> Int (return n))\n(fn f [] -> Int (let s "x") (return (g s)))',
    expect: /LL0203/,
  },
  {
    name: "P6: an optional PARAMETER must be unwrapped",
    source: "(fn f [t <- String?] -> Int (return (t.length)))",
    expect: /LL0205/,
  },
  {
    name: "P6: assignment to an annotated local",
    source: '(fn f [] -> Void (mut x <- Int 1) (x := "str"))',
    expect: /LL0202/,
  },
  {
    // The aliasing bug, from the other side: the parameter `g` currently OVERWRITES the top-level
    // function `g`'s inferred type with `String`, so `(g 1 2)` no longer sees a function at all and
    // the arity check silently disappears.
    name: "P6: arity survives a same-named parameter",
    source: "(fn g [a <- Int] -> Int (return a))\n(fn shadow [g <- String] -> Int (return 1))\n(g 1 2)",
    expect: /LL0211/,
  },

  // ...and the false-positive guards. These matter MORE: a checker that gets loud is only half the
  // proof. The two shadowing cases are expected to be RED TODAY -- as false positives -- which is the
  // cleanest possible demonstration that the flat table aliases names across scopes.
  {
    name: "P6: a local SHADOWS a top-level of another type",
    source: '(let x <- String "a")\n(fn f [] -> Int (let x <- Int 5) (return x))',
    silent: true,
  },
  {
    name: "P6: a parameter SHADOWS a top-level name",
    source: '(let n <- String "a")\n(fn f [n <- Int] -> Int (return (+ n 1)))',
    silent: true,
  },
  {
    name: "P6: a nil-guard on a PARAMETER is believed (== form)",
    source: "(fn f [t <- String?] -> Int (if (== t nil) (return 0)) (return (t.length)))",
    silent: true,
  },
  {
    name: "P6: a nil-guard on a PARAMETER is believed (!= form)",
    source: "(fn f [t <- String?] -> Int (if (!= t nil) (return (t.length))) (return 0))",
    silent: true,
  },
  {
    // The ruling: an unannotated `nil` initializer is `T?` with an unknown payload -- nilable, so
    // D9's forced unwrap still applies, but assignable FROM anything. Inferring `Nil` (today) makes
    // every later assignment an LL0202 false positive.
    name: "P6: an unannotated (mut x nil) accepts a later value",
    source: "(fn f [] -> Void (mut r nil) (r := 5))",
    silent: true,
  },

  // --- P7d: declaration-site variance (LL0214). ---
  { name: ":out in a parameter position", source: "(definterface P<:out T> (fn f [x <- T] -> Void))", expect: /LL0214/ },
  { name: ":in in a return position", source: "(definterface C<:in T> (fn f [] -> T))", expect: /LL0214/ },
  { name: ":out in a return position is legal", source: "(definterface P<:out T> (fn f [] -> T))", silent: true },
  { name: ":in in a parameter position is legal", source: "(definterface C<:in T> (fn f [x <- T] -> Void))", silent: true },
  { name: "an invariant T is legal in both positions", source: "(definterface I<T> (fn f [x <- T] -> T))", silent: true },
];

function runCases(): { failed: number; pending: number } {
  console.log("\n=== negative tests ===");
  const tmp = path.join(require("node:os").tmpdir(), "llang-type-cases");
  fs.mkdirSync(tmp, { recursive: true });

  let failed = 0;
  let pending = 0;

  for (const c of CASES) {
    const file = path.join(tmp, `${c.name.replace(/[^a-z0-9]+/gi, "_")}.lisp`);
    // Wrap in the conventional top-level list: a bare declaration is an error since LL0019.
    fs.writeFileSync(file, `(\n${c.source}\n)\n`);

    const diags = diagnose(file);
    const ok = c.silent
      ? diags.length === 0
      : diags.some((d) => c.expect!.test(d.text) || (d.code && c.expect!.test(d.code)));

    if (ok) {
      console.log(`  PASS  ${c.name}`);
    } else if (c.pending) {
      pending++;
      console.log(`  TODO  ${c.name}  (P4c, not implemented yet)`);
    } else {
      failed++;
      console.log(`  FAIL  ${c.name}`);
      if (c.silent) {
        for (const d of diags.slice(0, 3)) console.log(`          unexpected: ${d.text.slice(0, 92)}`);
      } else {
        console.log(`          expected ${c.expect}, got ${diags.length === 0 ? "nothing" : diags.map((d) => d.text.slice(0, 60)).join(" | ")}`);
      }
    }
  }

  return { failed, pending };
}

function main() {
  const corpus = measureCorpus();
  const { failed, pending } = runCases();

  console.log("\n=== summary ===");
  console.log(`  corpus diagnostics on passing tests: ${corpus.onTests}   (target: 0)`);
  console.log(`  negative tests failed              : ${failed}`);
  console.log(`  negative tests pending (P4c)       : ${pending}`);

  // Fail the run on a real regression only. `corpus.onTests` is expected to be non-zero until
  // P4a lands, so it is reported, not asserted -- otherwise the harness could never be committed
  // before the fix it exists to measure.
  process.exit(failed === 0 ? 0 : 1);
}

main();

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
import { SymbolTable } from "../compiler/analysis/SymbolTable";
import { MANIFEST } from "./manifest";

const EXAMPLES = path.resolve(__dirname, "../../examples");
const LIB = path.resolve(__dirname, "../../lib");
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

  // `lib/` as well as `examples/`.
  //
  // Sc2 moved the stdlib out of the corpus and into `lib/std/`, where it is a LIBRARY rather than an
  // example. Walking only `examples/` would therefore have quietly dropped the entire stdlib out of
  // the diagnostic harness -- recreating, deliberately and in the same phase that named it, the
  // "compiled but never examined" hole that Sa exists to expose. A stdlib nobody checks is how the
  // last one came to call four functions that do not exist.
  //
  // A lib/ file is a `library` by definition: imported, never run standalone, so it has no golden and
  // contributes to `total` rather than `onTests`. Sf gives it goldens and promotes it to `test`.
  const corpus = [...walk(EXAMPLES), ...(fs.existsSync(LIB) ? walk(LIB) : [])].sort();

  for (const file of corpus) {
    const inLib = file.startsWith(LIB + path.sep);
    const rel = inLib
      ? path.join("lib", path.relative(LIB, file))
      : path.relative(EXAMPLES, file);
    const status = inLib ? "library" : (MANIFEST[rel]?.status ?? "test");
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
  /**
   * WHICH phase owes this gate. The pending label used to be the hardcoded string "P4c", which was
   * already a lie for the nil-intermediate case and would have been a worse one for the D20 module
   * gates. A tracker that misattributes what it is tracking is not a tracker.
   */
  why?: string;
  /**
   * Sibling files written next to the case, so it can `(import "...")` one.
   *
   * A cross-MODULE bug cannot be stated in a single file, and the type checker's blindness to
   * imported symbols (P6e) is exactly that shape: it is handed the MODULE's symbol table, not the
   * joined one, so an imported function has no type at all and every check against it silently
   * degrades to Unknown.
   */
  deps?: Record<string, string>;
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
    // EXPRESSION position, deliberately. The CALL form `(t.length)` is checked by the case below and
    // is a DIFFERENT bug: `checkNotNil` lives on the identifier path, and a call HEAD never passes
    // through it. That gap is orthogonal to P6 -- it swallows a top-level optional exactly as much as
    // a parameter -- and writing this case in the call form would have made it look like P6's, and
    // "fixing" it here would have been fixing the wrong thing.
    name: "P6: an optional PARAMETER must be unwrapped",
    source: "(fn f [t <- String?] -> Int (let n t.length) (return 1))",
    expect: /LL0205/,
  },
  {
    // Orthogonal to P6, and NOT introduced by it -- measured identical for a top-level optional:
    //   (let h <- String? nil) (console.log (h.length))   -> nothing
    //   (let h <- String? nil) (let n h.length)           -> LL0205
    // Tracked here rather than in a comment, so it cannot be quietly forgotten.
    name: "a nil base is unchecked when the member is CALLED, not read",
    source: "(fn f [t <- String?] -> Int (return (t.length)))",
    expect: /LL0205/,
    pending: true,
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

  // --- P6e: the checker can see an IMPORTED symbol. ---
  //
  // `InferTypesAstVisitor` is handed the MODULE's symbol table, not the joined one, so an imported
  // function has no type at all: no arity check, no argument check, and an imported class annotation
  // degrades to Unknown. Every call across a module boundary is unchecked.
  {
    // NOT wrapped in `(console.log ...)`, deliberately. A call ARGUMENT is exactly where
    // `membersChecksOnly` swallows LL0203 and LL0211, so writing these the obvious way conflated the
    // cross-module question with the guard -- they read as RED for P6e's reason while actually being
    // suppressed for P6g's. Isolate the axis the case names; P6g's scorecard covers the other.
    name: "P6e: an imported function's ARITY is checked",
    deps: { "p6e_lib.lisp": '(\n(fn twice [x <- Int] -> Int (return (* x 2)))\n(export twice)\n)\n' },
    source: '(import "p6e_lib.lisp")\n(let r (twice 1 2 3))',
    expect: /LL0211/,
  },
  {
    name: "P6e: an imported function's ARGUMENT is checked",
    deps: { "p6e_lib.lisp": '(\n(fn twice [x <- Int] -> Int (return (* x 2)))\n(export twice)\n)\n' },
    source: '(import "p6e_lib.lisp")\n(let r (twice "str"))',
    expect: /LL0203/,
  },
  {
    name: "P6e: a CORRECT imported call stays silent",
    deps: { "p6e_lib.lisp": '(\n(fn twice [x <- Int] -> Int (return (* x 2)))\n(export twice)\n)\n' },
    source: '(import "p6e_lib.lisp")\n(let r (twice 21))',
    silent: true,
  },
  {
    // An UNANNOTATED imported function must stay unjudged -- gradual typing does not stop at a
    // module boundary. This is the false positive that folding the joined table in could buy.
    name: "P6e: an unannotated imported function is not judged",
    deps: { "p6e_any.lisp": '(\n(fn anything [x] (return x))\n(export anything)\n)\n' },
    source: '(import "p6e_any.lisp")\n(let r (anything "a"))',
    silent: true,
  },

  // --- P6f: `this` has a type. ---
  //
  // `bindIdentifier("this", ...)` is a no-op and always has been: BuildSymbolTableAstVisitor never
  // defines a symbol named `this`, so the write has nowhere to land (it is all 26 of P6b's lexical
  // write misses). So `this.x` typed as Unknown and every check on a field access silently passed.
  {
    name: "P6f: a field's type is real through `this`",
    source: '(defclass C (mut :ctor v <- Int 0)\n  (fn bad [] -> Int (return (- this.v "str"))))',
    expect: /LL0204/,
  },
  {
    // As an OPERAND, not as `this.v.length`. A chained member is a DIFFERENT gap -- the nil check
    // only ever examines the HEAD of a chain -- and it misses identically for a local base:
    //   (let c (C)) (let n c.v.length)   -> nothing
    // so it was never `this`'s. Tracked as its own case below.
    name: "P6f: an optional field must be unwrapped through `this`",
    source: '(defclass C (mut :ctor v <- String? nil)\n  (fn bad [] -> String (return (+ "x" this.v))))',
    expect: /LL0205/,
  },
  {
    // ...and it must be GUARDABLE. Reporting a field as possibly-nil while refusing to believe the
    // guard for it would make optional fields unusable -- the exact trap `nilGuard`'s own note warns
    // about. A check you cannot satisfy is worse than no check.
    name: "P6f: a nil-guard on a FIELD is believed",
    source: '(defclass C (mut :ctor v <- String? nil)\n  (fn ok [] -> String (if (== this.v nil) (return "e")) (return (+ "x" this.v))))',
    silent: true,
  },
  {
    // Orthogonal to P6, and NOT introduced by it: the nil check reads only the HEAD of a member
    // chain, so a possibly-nil INTERMEDIATE is invisible. Measured identical for a local base.
    name: "a nil INTERMEDIATE in a member chain is unchecked",
    source: '(defclass C (mut :ctor v <- String? nil))\n(let c (C))\n(let n c.v.length)',
    expect: /LL0205/,
    pending: true,
  },
  // ...and what it must NOT do. `:private` is per-CLASS: reading your own private field through
  // `this` is the entire point of having one.
  {
    name: "P6f: a private field IS readable through `this`",
    source: '(defclass C (mut :private :ctor secret <- Int 0)\n  (fn ok [] -> Int (return (+ this.secret 1))))',
    silent: true,
  },
  {
    name: "P6f: a correct field use through `this` stays silent",
    source: '(defclass C (mut :ctor v <- Int 0)\n  (fn ok [] -> Int (return (+ this.v 1))))',
    silent: true,
  },

  // --- Te: an IMPLICIT return is type-checked. ---
  //
  // `checkReturns` walks the body looking for `(return e)` lists. An implicit return -- a function
  // whose tail is bare -- has no such list, because CODEGEN adds the return and the type checker
  // never sees it. So a declared return type was enforced only if you happened to write `return`
  // yourself. The desugarer now injects it, so the return is THERE to be checked.
  {
    name: "Te: an implicit return is checked (literal tail)",
    source: '(fn f [] -> Int "str")',
    expect: /LL0213/,
  },
  {
    // THE CALL, not the literal. A literal tail has a different `_type` from the `(return e)` list
    // that wraps it, so their memo-cache keys (`${_type}_${start}_${end}`) differ. A CALL tail does
    // NOT: the synthesized return-list and the call collide on the key, the return is typed Unknown
    // first, and `checkReturns` then reads that poisoned entry and gives up. A literal-only gate
    // passes while every call-tail check is silently dead.
    name: "Te: an implicit return is checked (CALL tail)",
    source: '(fn g [] -> String (return "s"))\n(fn f [] -> Int (g))',
    expect: /LL0213/,
  },
  {
    name: "Te: an implicit return is checked (operator tail)",
    source: '(fn f [] -> Int (+ "a" "b"))',
    expect: /LL0213/,
  },
  {
    name: "Te: a CORRECT implicit return stays silent",
    source: '(fn g [] -> Int (return 1))\n(fn f [] -> Int (g))',
    silent: true,
  },
  {
    // A trailing `if` yields `undefined` today -- codegen's `isControlStatement` refuses to wrap it,
    // and its own comment says so. The desugarer must keep doing that, or a function whose tail is an
    // `if` silently starts returning a value where it returned nothing.
    name: "Te: a trailing `if` is NOT wrapped in a return",
    source: '(fn f [] -> Void (if true (console.log "a") (console.log "b")))',
    silent: true,
  },

  // --- P7d: declaration-site variance (LL0214). ---
  { name: ":out in a parameter position", source: "(definterface P<:out T> (fn f [x <- T] -> Void))", expect: /LL0214/ },
  { name: ":in in a return position", source: "(definterface C<:in T> (fn f [] -> T))", expect: /LL0214/ },
  { name: ":out in a return position is legal", source: "(definterface P<:out T> (fn f [] -> T))", silent: true },
  { name: ":in in a parameter position is legal", source: "(definterface C<:in T> (fn f [x <- T] -> Void))", silent: true },
  { name: "an invariant T is legal in both positions", source: "(definterface I<T> (fn f [x <- T] -> T))", silent: true },

  // -------------------------------------------------------------------------------------------
  // Sa (D20): THE MODULE BOUNDARY DOES NOT EXIST. `(export ...)` is decorative.
  //
  // `visitExport` records the list onto `SymbolEntry.exportName` -- which has ZERO readers. The gate
  // that actually decides visibility, `JSTransformerAstVisitor.isImportedSymbol`, tests only
  // "declared in another file" + "declared at top level", so it CONFLATES top-level with exported.
  // The one pass that does honour the list, `InlineImportsAstVisitor`, is commented out in Context.
  //
  // These are RED-but-tracked. They fail NOW, on purpose: the gate exists before the fix, so the
  // sub-phase that lands D20 cannot credit itself with a bug it did not fix.
  //
  // The codes are reserved in the LL02xx band, not near LL0004, for a reason worth writing down:
  // `diagnose()` above collects `LL02*` and nothing else, so a module diagnostic outside that band
  // would be INVISIBLE TO THIS HARNESS -- a gate that can never go green. It is also the right band
  // on the merits. These are name-VISIBILITY errors, and LL0210 ("is not defined") is their
  // neighbour: "I cannot see that name" and "there is no such name" are the same question, asked of
  // a different scope.
  //
  //   LL0215  a module-private symbol is not visible here
  //   LL0216  a selective import does not bind that name
  //   LL0217  the import cannot be resolved
  //   LL0218  a type is defined twice across one import path
  // -------------------------------------------------------------------------------------------
  {
    // Measured: this compiles clean and PRINTS BOTH. Corpus blast radius of enforcing it is 9
    // references in 2 files -- and every one is the stdlib leaking into itself
    // (`std/math.lisp` exports none of `abs min max pow ceil floor round inc`, nor `Complex`).
    name: "Sa/D20: an UNEXPORTED symbol is module-private",
    deps: { "sa_boundary.lisp": '(\n(fn public-fn [] -> String (return "pub"))\n(fn secret-fn [] -> String (return "sec"))\n(export public-fn)\n)\n' },
    source: '(import "sa_boundary.lisp")\n(console.log (secret-fn))',
    expect: /LL0215|module-private|not exported/,
    pending: true,
    why: "D20 -- Sb",
  },
  {
    // The companion, and NOT optional. Without it, Sb could go green by refusing EVERY import --
    // enforcing a boundary by walling off the module entirely. A check you satisfy by breaking the
    // feature is not a check. This one must be silent before AND after.
    name: "Sa/D20: an EXPORTED symbol stays visible",
    deps: { "sa_boundary.lisp": '(\n(fn public-fn [] -> String (return "pub"))\n(fn secret-fn [] -> String (return "sec"))\n(export public-fn)\n)\n' },
    source: '(import "sa_boundary.lisp")\n(console.log (public-fn))',
    silent: true,
  },
  {
    // `ImportDefinition.symbols` IS built by the AST builder and read by nobody, so a selective
    // import behaves identically to a whole-module one. `b` is exported -- but this import did not
    // ask for it, and that must be the difference.
    name: "Sa/D20: a SELECTIVE import binds only what it names",
    deps: { "sa_selective.lisp": '(\n(fn a [] -> Int (return 1))\n(fn b [] -> Int (return 2))\n(export a b)\n)\n' },
    source: '(import { a } from "sa_selective.lisp")\n(console.log (b))',
    expect: /LL0216|not bound|selective/,
    pending: true,
    // Reassigned Sb -> Sc. LL0215 is the EXPORT side (read `exportName`, symbol-side); LL0216 is the
    // IMPORT side (read `ImportDefinition.symbols`, per-importer state that does not exist yet).
    // Different mechanisms, no shared code -- so they are different sub-phases, and Sc touches the
    // import statement anyway for the resolver and LL0217.
    why: "D20 -- Sc",
  },
  {
    // Today this is a raw Node ENOENT thrown out of `fs.readFileSync` -- there is no `existsSync`
    // guard and no diagnostic anywhere on the import path. `diagnose()` swallows the crash, so this
    // reads as "no diagnostic", which is exactly the state D20 forbids.
    name: "Sa/D20: an UNRESOLVABLE import is a diagnostic, not an ENOENT",
    source: '(import "sa_no_such_module.lisp")\n(console.log 1)',
    expect: /LL0217|cannot be resolved|not found/,
    pending: true,
    why: "D20 -- Sc",
  },
  {
    // The stdlib does this to itself TODAY: `std/types.lisp` deftypes `Number`, and `std/math.lisp`
    // deftypes it AGAIN -- while importing `types.lisp`. Both export it. Completely silent.
    name: "Sa: a type defined TWICE across one import path",
    deps: { "sa_types.lisp": "(\n(deftype Number Int | Real)\n(export Number)\n)\n" },
    source: '(import "sa_types.lisp")\n(deftype Number Int | Real)\n(let x <- Number 1)',
    expect: /LL0218|already defined|redefin/,
    pending: true,
    why: "D20 -- Sf",
  },

  // -------------------------------------------------------------------------------------------
  // Sb (D20): the four doors, and the two things the boundary must NOT break.
  //
  // A name can reach a symbol from another module through more doors than `checkIdentifierResolves`,
  // and the difference is not academic -- it is the difference between enforcing D20 and appearing to.
  // -------------------------------------------------------------------------------------------
  {
    // THE HALF-FIX TRAP, and the reason this case exists at all.
    //
    // `new` does NOT go through `checkIdentifierResolves`. It routes to `inferNewExpression`, which
    // returns Unknown on a miss. So an Sb wired only into the obvious door passes every OTHER gate
    // in this file while a private class still leaks -- and the corpus proves it: the ONLY leaked
    // reference in `20-stdlib/complex_math_test/main.lisp` (a LIVE golden test) is `Complex`, and it
    // appears solely as `(new Complex 1.0 2.0)`.
    //
    // If this case is passing and that example is still green, the enforcement is a fiction.
    name: "Sb/D20: an unexported class is private through `new` too",
    deps: { "sb_new.lisp": "(\n(defstruct Pub (let :ctor v <- Int 0))\n(defstruct Priv (let :ctor v <- Int 0))\n(export Pub)\n)\n" },
    source: '(import "sb_new.lisp")\n(let p (new Priv 1))',
    expect: /LL0215|module-private|not exported/,
    pending: true,
    why: "D20 -- Sb",
  },
  {
    // AN OPERATOR IS EXEMPT -- W's ruling, applied. "An operator is not a name. It cannot be
    // shadowed, imported or redefined -- only OVERLOADED." A thing with no name has no export.
    //
    // This is not a nicety. `inlineImportedOperators()` -- the eager sweep that exists BECAUSE an
    // operator is found by dispatch and never by name -- routes through `isImportedSymbol`. Add a
    // blanket export check there and the operator stops being inlined, never reaches
    // `__ll_op_registry.register`, and W's bug returns whole. `src/test/imports.ts:395` guards the
    // codegen half with a lib that exports `Money` and NOT the operator; this guards the checker's.
    name: "Sb/D20: an unexported OPERATOR is still visible (W)",
    deps: { "sb_op.lisp": "(\n(defstruct Money (let :ctor amount <- Int 0))\n(fn :operator + [a <- Money b <- Money] -> Money\n  (return (Money (+ a.amount b.amount))))\n(export Money)\n)\n" },
    source: '(import "sb_op.lisp")\n(let total (+ (Money 3) (Money 4)))\n(console.log total.amount)',
    silent: true,
  },
  {
    // A module's OWN privates are its own. A predicate that forgets the same-file case would flag
    // every unexported top-level symbol in every program that happens to contain an `(export ...)` --
    // i.e. it would make `export` mean "the ONLY things that exist", which is not a boundary, it is
    // a wall. Silent now, and silent forever.
    name: "Sb/D20: a module's own private symbol is visible to ITSELF",
    source: '(fn helper [] -> Int (return 1))\n(fn main-fn [] -> Int (return (helper)))\n(export main-fn)\n(console.log (main-fn))',
    silent: true,
  },
  {
    // The type-annotation door. Zero corpus exposure today (measured: no example annotates with an
    // imported type), which is exactly why it would rot unnoticed. Wire it, and pin it.
    name: "Sb/D20: an unexported TYPE is private in an annotation",
    deps: { "sb_type.lisp": "(\n(defclass Pub)\n(defclass Priv)\n(export Pub)\n)\n" },
    source: '(import "sb_type.lisp")\n(fn f [x <- Priv] -> Int (return 1))',
    expect: /LL0215|module-private|not exported/,
    pending: true,
    why: "D20 -- Sb",
  },

  // --- Sc (D20), the IMPORT side. The two gates below are GUARDS, not targets. ---
  {
    // THE `symbols: []` TRAP, pinned.
    //
    // The frontends record "the importer named nothing" differently -- grammar_v2 writes
    // `symbols: []`, PEG omits the key entirely -- and BOTH mean "the whole module". Read `[]` as
    // "an empty set of bindings" instead, and every whole-module import in the language binds
    // NOTHING. The corpus would catch it (loudly, all at once), but the corpus is not a spec: this
    // is, and it says a whole-module import binds everything.
    name: "Sc/D20: a WHOLE-MODULE import still binds everything",
    deps: { "sc_whole.lisp": "(\n(fn a [] -> Int (return 1))\n(fn b [] -> Int (return 2))\n(export a b)\n)\n" },
    source: '(import "sc_whole.lisp")\n(console.log (a) (b))',
    silent: true,
  },
  {
    // ...and a selective import must still bind what it DOES name. Refusing everything is not a
    // boundary, it is a wall -- the same trap Sb's "own private symbol" gate guards against, on the
    // other side of the module.
    name: "Sc/D20: a selective import BINDS what it names",
    deps: { "sc_sel.lisp": "(\n(fn a [] -> Int (return 1))\n(fn b [] -> Int (return 2))\n(export a b)\n)\n" },
    source: '(import { a } from "sc_sel.lisp")\n(console.log (a))',
    silent: true,
  },

  {
    // Sd, found by REMOVING NOISE: `new`'s ARGUMENTS are never type-checked, or even visited.
    //
    // `inferNewExpression` reads args[0] -- the class name -- and returns. `args.slice(1)` is never
    // inferred, so an undefined function called as a constructor argument is completely invisible.
    // `99-p5js/main.lisp` had exactly this, live: `(new Platform x y (random-platform-type))`, where
    // `random-platform-type` is defined NOWHERE. A guaranteed ReferenceError the moment a platform
    // spawned, sitting silently under 104 ambient-global diagnostics.
    //
    // The same blindness hides argument-type and arity errors on every constructor call. Not fixed
    // here -- visiting those args is a checker change with its own blast radius, and Sd is about
    // ambient globals. Tracked, so that removing the noise leaves a record of what it was covering.
    name: "an argument to `new` is never checked",
    source: "(defclass P (let :ctor x <- Int 0))\n(let p (new P (bogus-fn)))",
    expect: /LL0210/,
    pending: true,
    why: "new's args are never visited -- surfaced by Sd",
  },

  // --- Sd3: the prelude. These are GUARDS. ---
  {
    // A JS global is now an ordinary symbol, declared `:extern` in lib/std/js.lisp and imported
    // implicitly. If the prelude fails to load -- a bad resolve, a missed recordImport, a missing
    // export -- this is what says so. And it would say so 579 times over in the corpus, which is at
    // least loud.
    name: "Sd/prelude: a JS global resolves without being imported",
    source: '(console.log (Math.max 1 2) (JSON.stringify [1]) (parseInt "42"))',
    silent: true,
  },
  {
    // THE COLLISION GUARD -- and it is written CROSS-MODULE on purpose, because the same-file version
    // of it PASSED while the bug was live.
    //
    // `Number` is both a JS value (`(Number str)` coerces) and an l-lang TYPE (`deftype Number` in
    // std/math and std/types), and l-lang resolves types and values from ONE namespace. Declaring
    // `Number` in the prelude was tried; it produced 11 LL0203s of exactly this shape.
    //
    // The mechanism is why the naive gate missed it. INSIDE std/math, `<- Number` resolves LEXICALLY
    // to that file's own deftype -- so an in-file annotation test looks fine. But when ANOTHER module
    // checks a CALL to one of math's functions, the parameter's type-ref is resolved in the CALLER's
    // scope, the lexical walk misses, and the flat cross-module fallback finds the extern -- a
    // variable, not a union. `Int` stops being assignable to `Number`.
    //
    // So the gate has to cross a module boundary, or it cannot see the thing it exists for.
    name: "Sd/prelude: `Number` survives as a TYPE across a module boundary",
    source: '(import "std/math")\n(console.log (sqr 4) (min 1 2) (pow 2 3))',
    silent: true,
  },
  {
    // ...and the value side of the same name must keep working. Both, or the split is not real.
    name: "Sd/prelude: `Number` is still a VALUE",
    source: '(let n (Number "42"))\n(console.log n)',
    silent: true,
  },

  // --- Se: why SYMBOL_MAP's library half cannot leave the compiler. ---
  {
    // THE GATE THAT UNBLOCKS `std/core`.
    //
    // `get`, `head` and `elem` are the language's ONLY producers of `T?` (inferTotalAccessorType), and
    // their type is `T[] -> T?` -- which l-lang CANNOT EXPRESS. Measured:
    //
    //     (let h (head xs)) (+ h 1)              -> LL0205    the builtin produces Int?
    //     (fn f [] -> Int? ...) (+ (f) 1)        -> LL0205    a CONCRETE optional works
    //     (fn my-head<T> [xs <- T[]] -> T? ...)  -> NOTHING   a GENERIC one does not
    //
    // So the gap is precisely call-site generic inference (Phase 5). Until it lands, moving head/get/
    // elem into a library would DELETE every optional check in the language -- and silently, because
    // inferTotalAccessorType disables itself the instant the name resolves to a symbol:
    //
    //     if (this.symbolTable.resolveSymbol(funcName)) return undefined;
    //
    // Merely DECLARING them in std/core is enough to do it. The check does not fail; it stops existing.
    //
    // This case is the link between the two phases. The day it goes green is the day `std/core`
    // becomes possible, and not before.
    name: "Se: a generic `-> T?` produces an optional at the call site",
    source:
      "(fn my-head<T> [xs <- T[]] -> T? (return (get xs 0)))\n" +
      "(let h (my-head [1 2 3]))\n" +
      "(console.log (+ h 1))",
    expect: /LL0205/,
    why:
      "Call-site generic inference (P5b-d) makes this real: `(my-head [1 2 3])` solves T=Int and the " +
      "return substitutes to `Int?`, so `(+ h 1)` on the un-narrowed optional is LL0205. Was `pending` " +
      "from before P5b-d landed; the machinery arrived, the gate was never un-pended. It unblocks " +
      "std/core, and Phase T / Ga is what spends that.",
  },
  {
    // ...and the guard: the builtin producers must keep producing. If this ever goes silent, something
    // has resolved `head` to a symbol and turned inferTotalAccessorType off.
    name: "Se: the builtin `head` still produces `T?` (guard)",
    expect: /LL0205/,
    source: "(let xs [1 2 3])\n(let h (head xs))\n(console.log (+ h 1))",
  },

  // --- P5a: a generic function can be WRITTEN. ---
  {
    // It could not be. `(fn f<T> [...])` was a PARSE ERROR in grammar_v2 -- `functionExpr` had no
    // generics slot -- while PEG lexed the whole of `f<T>` as ONE IDENTIFIER, because `<` and `>` are
    // identifier characters there (they have to be: `<`, `>`, `<=` and `>=` are operator NAMES). So
    // the PEG "parsed" it into a function called `f<T>` that nobody could ever call. A frontend
    // divergence, and a silent one.
    //
    // `FunctionNode.generics` had been declared the whole time, with a comment reading "NEVER
    // populated by either frontend", while every downstream binder already handled it. The ninth
    // "written and never wired in" -- and the reason "generic inference does not work" was never a
    // type-system problem at the root.
    name: "P5a: a generic function is CALLABLE by its real name",
    source: "(fn ident<T> [x <- T] -> T (return x))\n(console.log (ident 42))",
    silent: true,
  },
  {
    // ...and the operator names that FORCED `<`/`>` into the identifier charset must still parse.
    // A name rule that stops at an angle bracket has to let these through the other way.
    name: "P5a: `(fn :operator < ...)` still parses (guard)",
    source:
      "(defstruct M (let :ctor a <- Int 0))\n" +
      "(fn :operator < [x <- M y <- M] -> Boolean (return (< x.a y.a)))\n" +
      "(console.log (< (M 1) (M 2)))",
    silent: true,
  },

  // --- P5b: the unifier. `T` is SOLVED from the arguments, not erased. ---
  {
    // `T` really is Int, and the checker knows it. If unification silently did nothing, the return
    // would be a bare `T`, which isAssignable waves through in both directions -- so this going
    // SILENT is the failure mode, and it looks exactly like success.
    name: "P5b: `T` is solved from the argument",
    source: "(fn ident<T> [x <- T] -> T (return x))\n(let s <- String (ident 42))",
    expect: /LL0200/,
  },
  {
    // Solved THROUGH a container: `T[]` against `Int[]` recurses into the element.
    name: "P5b: `T` is solved through `T[]`",
    // `xs[0]`, the PARTIAL indexer, which really does return `T`. Written with `(elem xs 0)` -- the
    // TOTAL one -- this function returns `T?` and a `-> T` declaration is a genuine LL0213. The
    // erasure rule was hiding that, in this very test, until P5d deleted it. D9's partial/total split
    // is doing exactly what it was built for.
    source: "(fn first-of<T> [xs <- T[]] -> T (return xs[0]))\n(let s <- String (first-of [1 2 3]))",
    expect: /LL0200/,
  },
  {
    // ...and it flows into the OPERATORS, not just assignment.
    name: "P5b: a solved `T` reaches the operator tables",
    source: '(fn ident<T> [x <- T] -> T (return x))\n(let bad (- (ident "str") 1))',
    expect: /LL0204/,
  },
  // --- P5c: generic CLASSES. `(Box 42)` is a `Box<Int>`. ---
  {
    // NO ANNOTATION. This is the difference between generics working and generics being erased: the
    // existing invariance test annotates `<- Box<Dog>`, so the ANNOTATION did the work and the
    // inference was never exercised. `(Box (Dog))` now yields `Box<Dog>` on its own.
    name: "P5c: an INFERRED `Box<Dog>` is not a `Box<Animal>`",
    source:
      `${ANIMALS}\n` +
      "(defclass Box<T> (mut :ctor v <- T))\n" +
      "(fn take [b <- Box<Animal>] -> Void (console.log 1))\n" +
      "(let bd (Box (Dog)))\n" +
      "(take bd)",
    expect: /LL0203/,
  },
  {
    // The type argument reaches the MEMBER. `bi.v` on a `Box<Int>` is `Int`, not the bare `T` the
    // declaration says. Without this, instantiation would announce the argument and then throw it
    // away at the only place it matters.
    name: "P5c: a member of `Box<Int>` is `Int`, not `T`",
    source: "(defclass Box<T> (mut :ctor v <- T))\n(let bi (Box 42))\n(let s <- String bi.v)",
    expect: /LL0200/,
  },
  {
    // Constructor arguments, checked AT ALL for the first time. The class branch never called
    // checkCallArguments -- `(Box 1 2 3)` on a one-parameter constructor was not checked loosely, it
    // was not checked.
    name: "P5c: a constructor's ARITY is checked",
    source: "(defclass Box<T> (mut :ctor v <- T))\n(let bad (Box 1 2 3))",
    expect: /LL0211/,
  },
  {
    // ...and the two shapes the CORPUS caught, which the first version of the check got wrong. Both
    // are correct programs and must stay silent.
    //
    //   a DEFAULTED :ctor member is optional -- `(new Complex)` is legal when both carry `0.0`
    //   an INHERITED :ctor member counts -- `(new Dog "Buddy" "Golden")` is parent's, then own
    name: "P5c: defaulted and INHERITED constructor params (guard)",
    source:
      "(defstruct Cx (let :ctor re <- Real 0.0) (let :ctor im <- Real 0.0))\n" +
      "(defclass Animal (let :ctor name))\n" +
      "(defclass Dog :extends Animal (let :ctor breed))\n" +
      '(let z (new Cx))\n' +
      '(let d (new Dog "Buddy" "Golden"))\n' +
      "(console.log z d)",
    silent: true,
  },

  // ===============================================================================================
  // Fb / D24 -- a VALUE used before it is DECLARED. LL0219.
  //
  // The rule: a name is forward-referenceable iff it is not EVALUATED before its declaration. All
  // three cases below compiled CLEAN and crashed at run time.
  // ===============================================================================================
  {
    name: "D24: a top-level `let` naming a `let` declared later",
    source: "(let a x)\n(let x 1)\n(console.log a)",
    expect: /LL0219/,
  },
  {
    // A class is a TYPE in `<- Dog` and a VALUE in `(new Dog)`. This is the case the obvious rule --
    // "functions and types may forward-reference" -- would have PERMITTED, because a class reads as a
    // type. It is a `ReferenceError: Cannot access 'Dog' before initialization`.
    name: "D24: `(new Dog)` before `(defclass Dog)`",
    source: '(let d (new Dog "rex"))\n(defclass Dog (let :ctor name))\n(console.log d.name)',
    expect: /LL0219/,
  },
  {
    // `:extends` EVALUATES its parent at class-definition time -- `class Dog extends Animal` -- so a
    // parent declared later is a TDZ crash. `:implements` does not: an interface has no runtime
    // existence at all. Two clauses that look alike and are not.
    name: "D24: `:extends` a class declared later",
    source:
      '(defclass Dog :extends Animal (fn speak [] -> String (return "Woof")))\n' +
      '(defclass Animal (fn speak [] -> String (return "...")))\n' +
      "(let d (new Dog))\n(console.log (d.speak))",
    expect: /LL0219/,
  },

  // --- ...and the four guards. Each is a LEGAL program, and each is a way the rule could over-fire. ---
  {
    // THE HALF OF THE RULE THAT MATTERS. A function body runs AFTER module init, so it may name
    // anything at module scope regardless of order. Every mainstream language allows this, and so
    // does l-lang. Banning it was the tempting, simpler rule -- and it would have been wrong.
    name: "D24: a fn BODY may name a `let` declared later (deferred -- guard)",
    source: "(fn area [] -> Real (* PI 4))\n(let PI 3.14)\n(console.log (area))",
    silent: true,
  },
  {
    // Mutual recursion. `fn` emits `function f(){}`, which JS hoists -- and the corpus depends on it
    // (10-algorithms/04_recursion). This is why functions cannot be made declare-before-use.
    name: "D24: mutual recursion (a fn naming a later fn -- guard)",
    source:
      "(fn is-even [n <- Int] -> Boolean (if (== n 0) true (is-odd (- n 1))))\n" +
      "(fn is-odd [n <- Int] -> Boolean (if (== n 0) false (is-even (- n 1))))\n" +
      "(console.log (is-even 10))",
    silent: true,
  },
  {
    // TYPE position is always fine -- types are erased. And `:implements` names an interface, which
    // emits nothing at all, so implementing one declared later is harmless.
    name: "D24: a forward reference in TYPE position is fine (guard)",
    source:
      "(fn take [d <- Dog] -> Void (console.log 1))\n" +
      "(defclass Dog :implements Speaker (fn speak [] -> String (return \"Woof\")))\n" +
      "(definterface Speaker (fn speak [] -> String))\n" +
      "(take (new Dog))",
    silent: true,
  },
  {
    // THE FALSE-POSITIVE GUARD, and it is here because the first version of this check produced
    // exactly it: 29 diagnostics on passing tests.
    //
    // A PARAMETER'S NAME IS A BINDING, NOT A REFERENCE. `04-data-types/09_operators.lisp` declares
    // `(fn :operator + [c1 <- Complex c2 <- Complex] ...)` and, further down, top-level `(let c1 ...)`
    // and `(let c2 ...)`. A check that walks the AST for identifiers itself sees the parameter names
    // as forward references to those lets. checkIdentifierResolves' own note warns about this trap;
    // the cure is to ask from the reference-position path rather than re-derive it.
    name: "D24: a PARAMETER named like a later `let` is not a reference (guard)",
    source:
      "(defstruct C (let :ctor r <- Int 0))\n" +
      "(fn :operator + [c1 <- C c2 <- C] -> C (return (C (+ c1.r c2.r))))\n" +
      "(let c1 (C 1))\n(let c2 (C 2))\n" +
      "(let s (+ c1 c2))\n(console.log s.r)",
    silent: true,
  },

  // --- Na: an interface may `:implements` another interface. `Iterator<T> :implements Iterable<T>`
  // (std/iter, D30) is the load-bearing case, but the bug was general: `visitInterface` built an
  // interface's type from name + generics ONLY, dropping the `:implements` clause, so no sub-interface
  // ever conformed to its super and `isSubtype(Iterator, Iterable)` was always false. ---
  {
    name: "Na: a sub-interface value satisfies its super-interface (one hop)",
    source:
      "(definterface Shape (fn area [] -> Float))\n" +
      "(definterface Circle :implements Shape (fn radius [] -> Float))\n" +
      "(fn describe [s <- Shape] -> String \"a shape\")\n" +
      "(fn use-circle [c <- Circle] -> String (describe c))",
    silent: true,
    why: "Na: visitInterface must record :implements so isSubtype(Circle, Shape) holds.",
  },
  {
    name: "Na: sub-interface conformance is transitive (two hops)",
    source:
      "(definterface A (fn a [] -> Int))\n" +
      "(definterface B :implements A (fn b [] -> Int))\n" +
      "(definterface C :implements B (fn c [] -> Int))\n" +
      "(fn wants-a [x <- A] -> Int 0)\n" +
      "(fn give [z <- C] -> Int (wants-a z))",
    silent: true,
    why: "Na: isSubtype must re-resolve an interface's super-interfaces by name (C -> B -> A).",
  },

  // --- Nb: the checker TYPES an `:extension` call as its (instantiated) return, instead of Unknown.
  // This is what lets method-style LINQ chain -- a typed intermediate `(gen.map f)` for the next hop to
  // resolve on -- and it is observable here as a mismatch that only fires if the result really is typed. ---
  {
    name: "Nb: an :extension call types as its return -- a wrong assignment is caught",
    source:
      "(defstruct Foo (let :ctor v <- Int 0))\n" +
      "(fn :extension as-int [self <- Foo] -> Int 42)\n" +
      "(let f (Foo 1))\n" +
      "(let s <- String (f.as-int))",
    expect: /LL0200|Type mismatch/,
    why: "Nb: (f.as-int) must type as Int (its return), so String := Int is a mismatch. Was Unknown.",
  },
  {
    name: "Nb: an :extension call result is usable at its return type (guard)",
    source:
      "(defstruct Foo (let :ctor v <- Int 0))\n" +
      "(fn :extension as-int [self <- Foo] -> Int 42)\n" +
      "(let f (Foo 1))\n" +
      "(let n <- Int (f.as-int))",
    silent: true,
  },
  {
    name: "Nb: a generic :extension call solves its return -- a wrong assignment is caught",
    source:
      "(defstruct Foo (let :ctor v <- Int 0))\n" +
      "(fn :extension echo<T> [self <- Foo x <- T] -> T x)\n" +
      "(let f (Foo 1))\n" +
      "(let bad <- Int (f.echo \"hi\"))",
    expect: /LL0200|Type mismatch/,
    why: "Nb: T solves to String from the arg, so (f.echo \"hi\") is String; Int := String is a mismatch.",
  },
  {
    name: "Nb: a computed-receiver :extension call (chain 2nd hop) types as its return",
    source:
      "(defstruct Foo (let :ctor v <- Int 0))\n" +
      "(defstruct Bar (let :ctor v <- Int 0))\n" +
      "(fn :extension to-bar [self <- Foo] -> Bar (Bar 0))\n" +
      "(fn :extension bar-int [self <- Bar] -> Int 7)\n" +
      "(let f (Foo 1))\n" +
      "(let bad <- String ((f.to-bar).bar-int))",
    expect: /LL0200|Type mismatch/,
    why: "Nb: (f.to-bar) types as Bar (computed intermediate), so .bar-int resolves to Int; String := Int is a mismatch.",
  },

  // --- Ne: a LAZY-ONLY linq operator called METHOD-style on a BARE array is caught (LL0230). A bare
  // array is not a nominal `Iterable`, so the extension does not dispatch and codegen would emit
  // `arr.take(3)` -- a method arrays lack, a runtime crash. LL0230 turns it into a compile error that
  // points at the pipe or the `seq` gateway. Native array methods (`map`/`filter`) are NOT flagged. ---
  {
    name: "Ne: a lazy-only op method-style on a bare array is LL0230",
    source: '(import "std/linq")\n(let a [1 2 3])\n(a.take 3)',
    expect: /LL0230/,
    why: "Ne: arrays lack `take`; it can't dispatch (arrays aren't nominal Iterable). Use the pipe or `seq`.",
  },
  {
    name: "Ne: a native array method (map) method-style is NOT flagged",
    source: '(import "std/linq")\n(let a [1 2 3])\n(a.map (fn [x] x))',
    silent: true,
  },
  {
    name: "Ne: the `seq` gateway makes the array chainable -- no diagnostic",
    source: '(import "std/linq")\n(let a [1 2 3])\n((seq a).take 3)',
    silent: true,
  },

  // --- Ub: a tuple type `[Int Int]` carries meaning -- element-wise assignability, and DISTINCT from an
  // array (`[Int String]` is not an `Int[]`). Before Ub the annotation converted to Unknown. ---
  {
    name: "Ub: a matching vector literal is assignable to a tuple type",
    source: "(let p <- [Int Int] [1 2])",
    silent: true,
  },
  {
    name: "Ub: a wrong-element vector against a tuple type is caught",
    source: '(let q <- [Int Int] [1 "a"])',
    expect: /LL0200|Type mismatch/,
    why: "Ub: [1 \"a\"] types Array<Int|String>; Int|String is not assignable to the tuple's Int elements.",
  },
  {
    name: "Ub: a tuple is DISTINCT from an array (a `[Int Int]` is not an `Int[]`)",
    source: "(fn g [a <- Int[]] -> Int 0)\n(fn h [t <- [Int Int]] -> Int (g t))",
    expect: /LL0203/,
    why: "Ub: `[Int Int]` (fixed, positional) is not assignable to `Int[]` (variable-length) -- the point of tuples.",
  },

  // --- Ud: a DESTRUCTURING parameter binds its names from a tuple annotation -- `[x y] <- [Int Int]`
  // types `x`,`y` as `Int`. Destructuring was untyped (every name Unknown) before Ud. ---
  {
    name: "Ud: destructured tuple-param names are typed (correct use is silent)",
    source: "(fn f [[x y] <- [Int Int]] -> Int (+ x y))",
    silent: true,
  },
  {
    name: "Ud: a destructured tuple-param name carries its element type (misuse caught)",
    source: "(fn g [[x y] <- [Int Int]] -> String x)",
    expect: /LL0213|LL0200|Type mismatch/,
    why: "Ud: `x` is typed `Int` from the tuple, so returning it where `String` is declared is a mismatch (was Unknown -> silent).",
  },

  // --- Ue: EXPECTED-TYPE inference -- a vector literal in a tuple-annotated context infers as that tuple
  // (element-wise), so a HETEROGENEOUS tuple value is constructible. Before Ue the literal collapsed to
  // `Array<union>` and could never match a heterogeneous tuple. ---
  {
    name: "Ue: a heterogeneous vector literal constructs a tuple against its annotation",
    source: '(let p <- [Int String] [1 "a"])',
    silent: true,
    why: "Ue: [1 \"a\"] infers as [Int String] from the annotation (was Array<Int|String>, wrongly rejected).",
  },
  {
    name: "Ue: expected-type inference still catches a real element mismatch",
    source: "(let q <- [Int String] [1 2])",
    expect: /LL0200|Type mismatch/,
    why: "Ue: element 1 is `2`:Int against the expected String -- a mismatch, correctly.",
  },
  {
    name: "Ue: a `:gen` yielding a tuple pair type-checks against Iterator<[Int String]>",
    source: '(import "std/iter")\n(fn :gen e [] -> Iterator<[Int String]> (for :each x :from [1 2] :then ((yield [0 "a"]))))',
    silent: true,
    why: "Ue: the yield's `[0 \"a\"]` infers as `[Int String]` from the element type -- the enumerate/zip path (Ug).",
  },
  {
    name: "Ue: a wrong yielded pair is caught (Iterator<[Int String]>)",
    source: '(import "std/iter")\n(fn :gen e [] -> Iterator<[Int String]> (for :each x :from [1 2] :then ((yield [0 1]))))',
    expect: /LL0225/,
    why: "Ue: `[0 1]` yields `[Int Int]`, not the declared `[Int String]`.",
  },

  // --- Uf: a DESTRUCTURING for-each loop var is typed from the iterable's element (a tuple gives each
  // name its positional type). This is the consumer side of enumerate/zip. Was Unknown before. ---
  {
    name: "Uf: a destructured for-each loop var carries its tuple element type",
    source:
      '(import "std/iter")\n' +
      '(fn :gen pairs [] -> Iterator<[Int String]> (for :each x :from [1 2] :then ((yield [0 "a"]))))\n' +
      '(for :each [i s] :from (pairs) :then ((let bad <- Int s)))',
    expect: /LL0200|Type mismatch/,
    why: "Uf: `s` is String (element 1 of the tuple), so assigning it to Int is a mismatch. Was Unknown -> silent.",
  },
  {
    name: "Uf: a destructured for-each loop var used correctly is silent",
    source:
      '(import "std/iter")\n' +
      '(fn :gen pairs [] -> Iterator<[Int String]> (for :each x :from [1 2] :then ((yield [0 "a"]))))\n' +
      '(for :each [i s] :from (pairs) :then ((let n <- Int i)))',
    silent: true,
  },

  // --- P5d: the erasure rule is GONE. `T` is no longer a universal escape hatch. ---
  {
    // `(fn pair<T> [a <- T b <- T])` called as `(pair 1 "x")`: `T` is solved to `Int` from the first
    // argument, and the second is then checked against the SOLUTION. A generic call that does not
    // agree with itself is an error, not a widening to `Int | String`.
    //
    // This is the case the erasure rule swallowed: `String` against a bare `T` used to be waved
    // through unconditionally, in both directions.
    name: "P5d: a generic call must agree with ITSELF",
    source: '(fn pair<T> [a <- T b <- T] -> T (return a))\n(let p (pair 1 "x"))',
    expect: /LL0203/,
  },
  {
    // ...and the guard that says the deletion did not just make everything an error. A generic body
    // still works on its own `T` -- `this.value` really is `T` in there, and there is nothing to
    // compare it to. Gradual typing has to keep holding at exactly the point where inference stops.
    name: "P5d: a generic body still works on its own `T` (guard)",
    source:
      "(defclass Box<T> (mut :ctor v <- T)\n" +
      "  (fn get [] -> T (return this.v))\n" +
      "  (fn set [item <- T] -> Void (this.v := item)))\n" +
      "(let b (Box 42))\n" +
      "(b.set 7)\n" +
      "(console.log (b.get))",
    silent: true,
  },

  {
    // The correct call must stay SILENT. A unifier that reports on everything is not inference, it is
    // noise -- and this is the case that would catch a substitution that produced garbage.
    name: "P5b: a CORRECT generic call is silent",
    source:
      "(fn ident<T> [x <- T] -> T (return x))\n" +
      "(fn first-of<T> [xs <- T[]] -> T (return xs[0]))\n" +
      '(let a <- Int (ident 42))\n' +
      '(let b <- String (ident "s"))\n' +
      "(let c <- Int (first-of [1 2 3]))\n" +
      "(console.log a b c)",
    silent: true,
  },

  {
    // SETTLED. Was `pending` from Sf ("codegen guesses from a source-order list; D1 must rule on
    // `(x)` call-vs-grouping") -- and it took three things, in order:
    //
    //   Fa   codegen asks the SYMBOL TABLE, not a source-order list  -> `(f)` on a declared fn
    //   D1   `(x)` is a call iff `x` names a FUNCTION                -> the rule, from the corpus
    //   L    a LAMBDA HAS A TYPE                                     -> `(c5)` on a variable
    //
    // The last was the blocker: a lambda inferred `Unknown`, so a variable holding a function was
    // indistinguishable from a variable holding anything else. The checker had nothing to tell codegen.
    name: "D1: a zero-arg call to a local function value IS a call",
    source:
      "(fn make [] (fn [] 5))\n" +
      "(let c (make))\n" +
      "(let v (c))\n" +
      "(console.log v)",
    silent: true,
  },
  // -----------------------------------------------------------------------------------------------
  // Xf -- the checker has to REACH the code before any of its rules matter.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Xf: a block nested in a block is checked to its LAST item",
    // The harness wraps every case in `( ... )`, so this source's own parens make a block nested in a
    // block -- which is the whole point. Un-nest it by one level and the diagnostic appears.
    source: `(
  (fn helper [] -> Int (return 1))
  (console.log (totally-undefined-fn 1))
)`,
    expect: /LL0210/,
    why:
      "SILENT. `visitStatement`'s final branch is commented 'a wrapped special form -- if / for / " +
      "while / match', and it does `this.visit(head)` -- visits the FIRST item and returns. A genuine " +
      "multi-item BLOCK lands in the same branch, so everything after its first item is DROPPED: never " +
      "typed, never resolved, never checked by any rule we have. Measured: with a declaration first, " +
      "the undefined call raises nothing at all and dies at run time; put the call FIRST and it reports, " +
      "because then it happens to BE the head. " +
      "A check that silently does not run is worse than a check that does not exist -- you believe you " +
      "have it. Every diagnostic in this file rides on the checker actually reaching the code.",
  },
  {
    name: "Xf: a nested block that is CORRECT still says nothing",
    source: `(
  (fn helper [] -> Int (return 1))
  (console.log (helper))
)`,
    silent: true,
    why:
      "The guard. Making the checker reach dropped items is only a fix if it does not start inventing " +
      "diagnostics on code that was always fine.",
  },
  // -----------------------------------------------------------------------------------------------
  // Itb -- `for :each` types its element against Iterable<T> (D30). Was: the loop var was Unknown.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Itb: the :each loop var is typed as the array element",
    source: `(let xs [1 2 3])
(for :each x :from xs :then (
  (let bad <- String x)
))`,
    expect: /LL0200/,
    why:
      "the loop variable had NO type -- `(for :each x :from [1 2 3])` left `x` Unknown, so nothing " +
      "downstream could be checked against it. It is `Int` (the element type of `Int[]`), and assigning " +
      "it to a `String` must be caught.",
  },
  {
    name: "Itb: a :each loop var typed Int rejects a string operand",
    source: `(for :each n :from [10 20 30] :then (
  (let bad <- Int (+ n "s"))
))`,
    expect: /LL0200|LL0204/,
    why: "`n : Int`, so `(+ n \"s\")` is a type error -- the element type must reach the operator check.",
  },
  {
    name: "Itb: a KNOWN non-iterable collection is diagnosed",
    source: `(for :each x :from 5 :then (console.log x))`,
    expect: /LL0221/,
    why:
      "5 is an Int -- not iterable. A scalar in `:from` is a mistake, and the checker now says so " +
      "(conservatively: only for a KNOWN non-iterable scalar, never for Unknown).",
  },
  {
    name: "Itb: an Unknown collection stays SILENT (gradual)",
    source: `(fn mystery [] (return 42))
(for :each x :from (mystery) :then (console.log x))`,
    silent: true,
    why:
      "GUARD. `(mystery)` returns an un-annotated 42, so its type is Unknown -- and the rule that " +
      "governs this whole checker is: never report against Unknown. `x` binds Unknown, no diagnostic.",
  },
  {
    name: "Itb: the loop BODY is still checked (reachability)",
    source: `(for :each x :from [1 2 3] :then (
  (console.log (totally-undefined-fn x))
))`,
    expect: /LL0210/,
    why:
      "GUARD, and the Xf lesson: adding `visitForEach` OVERRIDES the generic child-walk, so it must " +
      "visit the body itself or every check silently stops running inside the loop.",
  },
  // -----------------------------------------------------------------------------------------------
  // Gb -- the diagnostics that ENFORCE D31. yield/return discipline, the Iterator return type.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Gb: `yield` outside a `:gen` function is an error",
    source: `(fn plain [] -> Int (
  (yield 1)
  (return 2)
))`,
    expect: /LL0222/,
    why:
      "`yield` produces-and-suspends; it has no meaning in a function that is not a generator. Because " +
      "`:gen` is explicit (D31), a yield in a non-`:gen` function is unambiguously a mistake.",
  },
  {
    name: "Gb: a value `(return x)` inside a `:gen` is an error",
    source: `(fn :gen g [] -> Iterator<Int> (
  (yield 1)
  (return 5)
))`,
    expect: /LL0223/,
    why:
      "a generator STOPS with a valueless `(return)`; a value has no place in the sequence. Silently " +
      "discarding it is the JS/Python trap; C# forbids it, and so do we. Produce with `(yield x)`.",
  },
  {
    name: "Gb: a `:gen` with a non-Iterator return type is an error",
    source: `(fn :gen g [] -> Int (
  (yield 1)
))`,
    expect: /LL0224/,
    why:
      "the ruling: a generator's declared type is the full `Iterator<T>` -- what a called generator " +
      "actually is. `-> Int` is not it.",
  },
  {
    name: "Gb: `yield x` is checked against the generator's element type",
    source: `(fn :gen g [] -> Iterator<Int> (
  (yield "not an int")
))`,
    expect: /LL0225/,
    why: "`Iterator<Int>` yields Ints; `(yield \"s\")` is a type error, like a mismatched return.",
  },
  {
    name: "Gb: a `:gen` that never yields is WARNED",
    source: `(fn :gen g [] -> Iterator<Int> (
  (return)
))`,
    expect: /LL0226/,
    why:
      "an empty generator is almost always a mistake -- a `:gen` you forgot to `yield` in. A warning, " +
      "not an error: an empty sequence is legal, just suspicious.",
  },
  {
    name: "Gb: a CORRECT generator is silent",
    source: `(fn :gen count-up [n <- Int] -> Iterator<Int> (
  (mut i 0)
  (while (< i n) (
    (yield i)
    (i := (+ i 1))))))`,
    silent: true,
    why:
      "GUARD. All five rules must leave a well-formed generator alone: it yields, it returns nothing, " +
      "its type is Iterator<Int>, and every yield is an Int.",
  },
  // -----------------------------------------------------------------------------------------------
  // Ab -- the async TYPE rules (D32). The runtime already worked; these make the checker agree.
  // -----------------------------------------------------------------------------------------------
  {
    name: "Ab: an :async returning its payload under -> Task<T> is SILENT",
    source: `(fn :async f [] -> Task<Int> (
  (return 5)
))`,
    silent: true,
    why:
      "THE BUG D32 names. `(return 5)` produces the Int the Task RESOLVES to -- the payload, not the " +
      "wrapper. Checking it against `Task<Int>` false-positived LL0213 on EVERY annotated async " +
      "function. The return is checked against the unwrapped `T`.",
  },
  {
    name: "Ab: a wrong-payload return in an :async is caught",
    source: `(fn :async f [] -> Task<Int> (
  (return "not an int")
))`,
    expect: /LL0213/,
    why: "unwrapping to the payload does not mean skipping the check -- `Task<Int>` resolves an Int, not a String.",
  },
  {
    name: "Ab: `(await e)` unwraps Task<T> to T",
    source: `(fn :async f [] -> Task<Int> (return 5))
(fn :async g [] -> Task<Int> (
  (let r (await (f)))
  (let bad <- String r)
  (return 0)
))`,
    expect: /LL0200/,
    why: "`(f)` is `Task<Int>`, so `(await (f))` is `Int`; assigning it to a `String` must be caught.",
  },
  {
    name: "Ab: `await` outside an :async function is an error",
    source: `(fn plain [] -> Int (
  (let r (await (some-task)))
  (return 1)
))`,
    expect: /LL0227/,
    why:
      "`await` suspends on an awaitable; it has no meaning outside an `:async` function, and l-lang " +
      "does not do top-level await. Mirrors `yield` outside `:gen`.",
  },
  {
    name: "Ab: an :async with a non-Task return type is an error",
    source: `(fn :async f [] -> Int (
  (return 5)
))`,
    expect: /LL0228/,
    why: "the ruling: an async function's declared type is the awaitable wrapper -- `Task<T>` -- not the bare `T`.",
  },
  {
    name: "Ab: a correct async function is silent",
    source: `(fn :async fetch [id <- Int] -> Task<Int> (
  (return (+ id 100))))`,
    silent: true,
    why: "GUARD. A well-formed async: awaitable return type, payload return, no stray await.",
  },

  // Phase E / Eb -- the :extension discipline.
  {
    name: "Eb: an :extension with no receiver parameter is an error",
    source: `(fn :extension nothing [] -> Int (return 1))`,
    expect: /LL0229/,
    why:
      "An extension method IS a method on its first parameter -- the receiver. With no parameter it " +
      "extends nothing and can never dispatch. LL0229 names it, rather than letting it compile into a " +
      "free function nobody can reach as `(x.nothing)`.",
  },
  {
    name: "Eb: a well-formed :extension is silent",
    source: `(defstruct Box (let :ctor v <- Int))
(fn :extension doubled [self <- Box] -> Int (* self.v 2))`,
    silent: true,
    why: "GUARD. A receiver parameter is all it needs; an untyped receiver is allowed (it just never dispatches).",
  },

  // Phase T / Ga -- the generic stdlib accessors, now that call-site inference works (P5b-d).
  {
    name: "Ga: a generic stdlib `first` produces an optional at the call site",
    source: `(import "std/seq")
(let h (first [1 2 3]))
(console.log (+ h 1))`,
    expect: /LL0205/,
    why:
      "`first<T> [T[]] -> T?` -- (first [1 2 3]) is Int?, so using it in `+` without a nil-check is " +
      "LL0205. RED before Ga (first shipped untyped -> Unknown -> silent). The stdlib mirror of the " +
      "now-passing `Se` gate.",
  },
  {
    name: "Ga: a narrowed `first` is silent",
    source: `(import "std/seq")
(let h (first [1 2 3]))
(if (!= h nil) (console.log (+ h 1)) (console.log 0))`,
    silent: true,
    why: "GUARD. After (!= h nil), D9 narrows h from Int? to Int, so `+` is fine.",
  },

  // Phase T / Ja -- native member types. The checker learns String/Array/Date/Error members, so member
  // access on a native receiver types instead of degrading to Unknown. (Codegen still __ll_member until Jb.)
  {
    name: "Ja: `s.length` types as Int",
    source: `(let s "hello")
(let n <- String s.length)`,
    expect: /LL0200/,
    why:
      "`String.length` is `Int`, so binding it to `<- String` is a mismatch (LL0200). RED before Ja: " +
      "`s.length` was Unknown, assignable to anything, silent.",
  },
  {
    name: "Ja: `arr.shift` types as T? (the element, optional)",
    source: `(let arr [1 2 3])
(let x (arr.shift))
(console.log (+ x 1))`,
    expect: /LL0205/,
    why:
      "`Array<T>.shift` is `T?` -- here `Int?` -- so `(+ x 1)` on the un-narrowed optional is LL0205. " +
      "RED before Ja: `arr.shift` was Unknown, silent. `T` comes from the receiver, not call-site solving.",
  },
  {
    name: "Ja: `s.length` bound to Int is silent",
    source: `(let s "hello")
(let n <- Int s.length)`,
    silent: true,
    why: "GUARD. `String.length` is `Int`, assignable to `<- Int`. A user shadow of a native member would win.",
  },
];

function runCases(): { failed: number; pending: number } {
  console.log("\n=== negative tests ===");
  const tmp = path.join(require("node:os").tmpdir(), "llang-type-cases");
  fs.mkdirSync(tmp, { recursive: true });

  let failed = 0;
  let pending = 0;

  for (const c of CASES) {
    const file = path.join(tmp, `${c.name.replace(/[^a-z0-9]+/gi, "_")}.lisp`);
    for (const [depName, depSource] of Object.entries(c.deps ?? {})) {
      fs.writeFileSync(path.join(tmp, depName), depSource);
    }
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
      console.log(`  TODO  ${c.name}  (${c.why ?? "not implemented yet"})`);
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

/**
 * P6's safety instrument.
 *
 * A type is inferred for a name and then WRITTEN onto that name's symbol, lexically. A miss means
 * the compiler inferred a type and had nowhere to put it -- a scope the builder never created, or a
 * `from` that cannot reach one.
 *
 * It is reported because the failure mode it guards against is INVISIBLE: `resolveSymbol` falls back
 * to a flat search when the lexical walk misses, so a half-landed migration -- a broken `_parent`, an
 * unindexed scope -- degrades into exactly the old behaviour and passes every test while doing
 * nothing. A hit count that collapses, or a miss count that grows, is the only way to see it.
 */
function reportLexicalStats(): void {
  const { hits, misses, missNames } = SymbolTable.getLexicalStats();
  console.log("\n=== lexical WRITES (P6) ===");
  console.log(`  types bound to the right symbol: ${hits}`);
  console.log(`  types with nowhere to go        : ${misses}`);
  if (misses) {
    const top = [...missNames.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
    for (const [name, n] of top) console.log(`      ${String(n).padStart(4)}x  ${name}`);
  }
}

function main() {
  SymbolTable.resetLexicalStats();
  const corpus = measureCorpus();
  reportLexicalStats();
  const { failed, pending } = runCases();

  console.log("\n=== summary ===");
  console.log(`  corpus diagnostics on passing tests: ${corpus.onTests}   (target: 0)`);
  console.log(`  negative tests failed              : ${failed}`);
  console.log(`  negative tests pending (tracked)   : ${pending}`);

  // Fail the run on a real regression only. `corpus.onTests` is expected to be non-zero until
  // P4a lands, so it is reported, not asserted -- otherwise the harness could never be committed
  // before the fix it exists to measure.
  process.exit(failed === 0 ? 0 : 1);
}

main();

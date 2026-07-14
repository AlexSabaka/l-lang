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
    why: "D20 -- Sb",
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

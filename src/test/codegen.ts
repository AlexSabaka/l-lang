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
  /** Exact expected stdout lines, in order. Omit when the case expects a compile diagnostic. */
  expect?: string[];
  /**
   * The case must NOT compile, and must report this diagnostic.
   *
   * A silent degradation is the bug class this whole audit exists to kill, so "the compiler refuses,
   * loudly, and says why" is a behaviour worth asserting -- not merely the absence of a crash.
   */
  expectDiagnostic?: RegExp;
  /**
   * The case must COMPILE, RUN, and then THROW -- with this error reaching stderr.
   *
   * D9 rules that `c[k]` is PARTIAL: an out-of-bounds index and an absent map key are *bugs*, not
   * values, and a bug must be loud. That is the one behaviour this harness could not previously
   * express -- a nonzero exit was unconditionally a failure -- so an intended throw was untestable
   * and, by construction, the safest thing to leave unimplemented.
   */
  expectThrow?: RegExp;
  /**
   * Assertions on the EMITTED TEXT, not the output.
   *
   * Needed for anything whose correctness is invisible at run time. A `:comptime` fold produces the
   * same number whether it folded or merely ran -- the only proof it FOLDED is that the function is
   * gone from the emitted JavaScript. Likewise, the only proof a do-nothing modifier is not secretly
   * a memoizer is that no cache appears in the output.
   */
  emitted?: { must?: RegExp[]; mustNot?: RegExp[] };
  /** What was wrong before -- printed on failure, so a regression names its own bug. */
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
    name: "when: a false condition yields nil",
    source: `(let v (when false :then "x"))
(console.log v)`,
    // Was `undefined` until D9c. `when` has no else (WhenNode {condition, then[]}), so a false
    // condition yields the bottom value -- and the bottom value is nil, spelled `null`, the same one
    // the `nil` literal produces. That it used to be a DIFFERENT bottom is the bug D9 exists to kill.
    expect: ["null"],
    wasBroken: "`when` has no else; a false condition yielded `undefined` -- the second bottom value",
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

  // ===============================================================================================
  // D3 -- METAPROGRAMMING
  // ===============================================================================================

  // --- defmodifier. Today `visitModifierDef` never reads the body and emits the SAME hardcoded
  // memoizer for every modifier, whatever it is called and whatever it says. Nobody noticed because
  // every defmodifier in the corpus has an EMPTY body, and memoizing a pure function is
  // observationally identical to leaving it alone. ---
  {
    name: "defmodifier: an empty body is a PASS-THROUGH, not a memoizer",
    source: `(defmodifier identity [])
(fn :identity greet [name <- String] -> String (+ "Hello, " name))
(console.log (greet "Alice"))`,
    expect: ["Hello, Alice"],
    // The output is IDENTICAL either way -- memoizing a pure function is invisible. The only proof
    // is in the emitted text. This is the case that catches the fraud.
    emitted: { mustNot: [/new Map\(\)/, /cache\.set/] },
    wasBroken:
      "(defmodifier identity []) -- an explicitly do-nothing modifier -- emitted a memoizing cache",
  },
  {
    name: "defmodifier: a body with SIDE EFFECTS actually runs",
    source: `(defmodifier logged []
  (fn [original]
    (fn [...args]
      (console.log "calling with" args)
      (original ...args))))
(fn :logged add [a <- Int b <- Int] -> Int (+ a b))
(console.log (add 2 3))`,
    expect: ["calling with [ 2, 3 ]", "5"],
    wasBroken:
      "a defmodifier with a non-empty body CRASHED the compiler: 'Already at the root scope. Cannot exit.'",
  },
  {
    name: "defmodifier: a memoizer memoizes BY DECLARATION, not by accident",
    // `(get cache n)`, not `cache[n]`, for the "is it cached?" question -- the indexer is PARTIAL
    // after D9f and an absent key THROWS. The WRITE stays a plain `cache[n] :=` (a write creates),
    // and so does the final read, which happens only once the key is known to be there.
    source: `(defmodifier memoized []
  (fn [original]
    (let cache {})
    (fn [n]
      (if (== (get cache n) nil)
          (cache[n] := (original n)))
      cache[n])))
(fn :memoized slow [n <- Int] -> Int (console.log "computing" n) (* n 2))
(console.log (slow 4))
(console.log (slow 4))`,
    // "computing 4" must appear ONCE -- the second call is served from the cache.
    expect: ["computing 4", "8", "8"],
    // NOTE the body is written as multiple items, NOT as one parenthesized block. A single-block
    // body -- `((console.log …) (* n 2))` -- silently loses its implicit return and yields undefined,
    // while the identical multi-item body returns 8. That is a real bug, it is NOT a modifier bug,
    // and it is recorded as an open finding rather than absorbed into this phase. Writing the case
    // in the broken spelling would have tested that bug instead of this one.
    wasBroken: "every modifier was a memoizer; this one is a memoizer because its body says so",
  },
  {
    name: "defmodifier: arguments reach the modifier",
    source: `(defmodifier tagged [tag <- String]
  (fn [original]
    (fn [...args]
      (console.log "tag:" tag)
      (original ...args))))
(fn :tagged["A"] ping [] -> Void (console.log "ping"))
(ping)`,
    expect: ["tag: A", "ping"],
    // Both frontends already PARSE `:tagged["A"]` and hand codegen a modifier node carrying
    // `args: ["A"]`, and the defmodifier's `params: ["tag"]`. Only codegen throws both away.
    wasBroken:
      "modifier args parsed and were discarded; getModifierArgs exists in helpers/modifiers.ts and is dead",
  },

  // --- :comptime. It FOLDS -- see the retraction in DECISIONS.md. The gap is that a fold which
  // FAILS degrades silently to run time. ---
  {
    name: "comptime: a fold really folds (the function is GONE from the output)",
    source: `(fn :comptime twice [n <- Int] -> Int (* n 2))
(let six (twice 3))
(console.log six)`,
    expect: ["6"],
    // `6` proves nothing on its own -- a run-time call prints 6 too. The proof of a FOLD is that the
    // function is not in the emitted JavaScript at all.
    emitted: { must: [/\b6\b/], mustNot: [/function twice|const twice|twice\s*=/] },
    wasBroken: "not broken -- a guard, and the case that would have caught my false retraction",
  },
  {
    name: "comptime: a FOLD agrees with the RUNTIME",
    source: `(let :comptime folded (+ 1 2 3))
(let ran (+ 1 2 3))
(console.log folded ran)`,
    expect: ["6 6"],
    // The sharpest bug in D3, and invisible to every other kind of test: the comptime sandbox
    // hand-rolled its own operators, and its `+` was BINARY while the real runtime's is VARIADIC. So
    // the identical expression gave 3 when folded and 6 when run. `:comptime` silently changed the
    // ANSWER. A compile-time evaluator that disagrees with the run-time one is worse than none --
    // the bug appears only in the builds where the fold happens to fire.
    emitted: { must: [/\b6\b/] },
    wasBroken: "folded to 3, ran to 6 -- the sandbox's `+` dropped every argument after the second",
  },
  {
    name: "comptime: operators beyond the hand-rolled ten (%, &&) fold",
    source: `(fn :comptime is-even [n <- Int] -> Boolean (== (% n 2) 0))
(console.log (is-even 4))`,
    expect: ["true"],
    wasBroken: "the sandbox defined 10 operators; `%`, `&&`, `||` and `!` were not among them",
  },
  {
    name: "comptime: a call that CANNOT be folded is an error, not a ReferenceError",
    source: `(fn :comptime twice [n <- Int] -> Int (* n 2))
(let x 5)
(let y (twice x))
(console.log y)`,
    expectDiagnostic: /LL0099/,
    // NOT merely a "silent downgrade to run time" -- worse. The comptime function is DELETED from the
    // output unconditionally, while the call is only replaced when every argument is a literal. `x`
    // is a runtime binding, so the fold does not fire: the callee is gone, the call remains, and the
    // program ships a guaranteed `ReferenceError: twice is not defined` with ZERO diagnostics.
    wasBroken:
      "the comptime fn was deleted and the unfoldable call left behind -> ReferenceError at run time, reported by nothing",
  },

  // --- defmacro: D3 rules macros OUT, and demands a located error, "never a silent call". ---
  {
    name: "defmacro is a located error, not a crash",
    source: `(defmacro my-macro [x] (+ x 1))
(console.log "unreachable")`,
    expectDiagnostic: /LL0023/,
    wasBroken: "a raw parse error under grammar_v2; invalid JS under PEG. D3 wants it located and named",
  },

  // --- quote: emits the AST as a JSON STRING, so it cannot be indexed or walked. ---
  {
    name: "quote is DATA, not a JSON string",
    source: `(let expr '(+ 1 2))
(let op expr.nodes[0])
(console.log op.id)
(console.log expr._type)`,
    expect: ["+", "list"],
    // Written in two steps deliberately. `expr.nodes[0].id` -- member access AFTER an indexer --
    // does not parse: it emits `expr.nodes[0], id`, a comma expression, and `id` becomes a separate
    // argument. That is a real grammar bug, it has nothing to do with quote, and it is recorded as
    // an open finding rather than absorbed here.
    wasBroken: "visitQuote emitted JSON.stringify(node), so `expr` was a STRING and expr.nodes a TypeError",
  },
  {
    name: "string interpolation is NOT a quote and must not regress",
    source: `(let name "Sloth")
(console.log '"Hello, {(name)}!")`,
    expect: ["Hello, Sloth!"],
    wasBroken: "not broken -- a guard. `'\"` is a formatted-string, split from `'` by a negative lookahead",
  },

  // ===============================================================================================
  // P8 -- PAPERCUTS. Ordinary code that silently does the wrong thing.
  // ===============================================================================================

  // --- Member access AFTER an indexer. `primaryExpr` is `identifier indexerSuffix*` -- there is no
  // member access afterwards -- so `.name` falls out of the loop and parses as a HEADLESS
  // composite-identifier (`.bar` is a legal form), becoming its own argument. ---
  {
    name: "indexer then member: xs[0].name",
    source: `(let xs [{ :name "a" } { :name "b" }])
(console.log xs[1].name)`,
    expect: ["b"],
    wasBroken:
      "emitted `console.log(xs[1], name)` -- the `.name` was LOST -> ReferenceError, zero diagnostics",
  },
  {
    name: "indexer then member, chained: a.b[0].c",
    source: `(let obj { :items [{ :label "x" }] })
(console.log obj.items[0].label)`,
    expect: ["x"],
    wasBroken: "the `.label` was lost the same way; reaching into any nested structure hits this",
  },
  {
    name: "member, indexer, indexer, then member",
    source: `(let m { :rows [[{ :v 10 } { :v 20 }]] })
(console.log m.rows[0][1].v)`,
    expect: ["20"],
    // An index CHAIN already worked (`m.rows[0][1]`); it is a MEMBER after an index that is lost.
    // This case has to end on the member, or it passes vacuously.
    wasBroken: "the trailing `.v` was lost -- index chains worked, a member after an index did not",
  },
  {
    name: "(obj.m) is still a CALL, not a member read (D1)",
    source: `(defclass Greeter (fn hi [] -> String (return "hi")))
(let gs [(Greeter)])
(console.log (gs[0].hi))`,
    expect: ["hi"],
    wasBroken: "not broken -- a guard. D1: `(obj.m)` is ALWAYS a call; bare `obj.m` is the read",
  },

  // --- The implicit return, lost when a body is ONE parenthesized block. ---
  {
    name: "implicit return: a single-block body returns its last expression",
    source: `(fn f [n <- Int] -> Int ((console.log "side") (* n 2)))
(console.log (f 4))`,
    expect: ["side", "8"],
    wasBroken:
      "returned undefined. The identical multi-item body -- `(fn f [n] (log) (* n 2))` -- returned 8",
  },
  {
    name: "implicit return: the two spellings AGREE",
    source: `(fn block-body [n <- Int] -> Int ((let d (* n 2)) (+ d 1)))
(fn multi-body [n <- Int] -> Int (let d (* n 2)) (+ d 1))
(console.log (block-body 4) (multi-body 4))`,
    expect: ["9 9"],
    // The block must hold MORE THAN ONE item, or it passes vacuously: `visitList` returns a lone
    // statement as itself (an expression), so a one-item block `((* n 2))` already returned fine.
    // Only a multi-item block emits a BlockStatement, which is what drops the value.
    wasBroken: "the same program, two spellings, two different answers: undefined and 9",
  },
  {
    name: "implicit return: an explicit return still wins",
    source: `(fn f [n <- Int] -> Int ((return (* n 3)) (* n 2)))
(console.log (f 4))`,
    expect: ["12"],
    wasBroken: "guards the fix -- adding an implicit return must not override an explicit one",
  },

  // --- `fn` parameter DEFAULTS are DEFERRED, not fixed. See the open finding in DECISIONS.md:
  // `(fn greet [name <- String "World"])` cannot work -- a parameter list is space-separated, so
  // `[a b]` is unresolvably "two parameters" or "a defaulting to b". This case guards the fact that
  // a bare trailing expression must NOT be silently accepted as a default, which is what my first
  // attempt did: `[a <- Int b <- Int]` parsed as `a` defaulting to `b`, plus a parameter named `<-`.
  {
    name: "a parameter list is NOT ambiguous: [a b] is two parameters",
    source: `(fn add [a <- Int b <- Int] -> Int (+ a b))
(console.log (add 2 3))`,
    expect: ["5"],
    wasBroken:
      "guards the deferral -- a trailing expression in a parameter would silently eat the NEXT parameter",
  },

  // --- String keys in map literals. `keyValue` requires a leading colon. ---
  {
    name: "map literal: bare string keys",
    source: `(let config {"host" "localhost" "port" 8080})
(console.log config["host"] config["port"])`,
    expect: ["localhost 8080"],
    wasBroken: "parse error -- the `keyValue` rule required a leading colon. This blocks 02_maps.lisp",
  },
  {
    name: "map literal: :keyword keys still unmangled (D13)",
    source: `(let m { :my-key 1 })
(console.log (JSON.stringify m))`,
    expect: ['{"my-key":1}'],
    wasBroken: "not broken -- a guard. Adding a string-key form must not disturb the colon form",
  },

  // ===============================================================================================
  // D9 -- what is `nil`?   (DECISIONS.md:99-108)
  //
  // "Non-nullable by default, explicit `T?` optionals, ONE bottom value."
  //
  // The premise that reframed the phase: non-nullable-by-default is ALREADY TRUE for every annotated
  // slot -- nothing ever sets `nullable` on a target, so isAssignable(Null, String) is false and
  // `(let x <- String nil)` already errors. D9 is not a tightening. It is a cage with no door, and
  // `T?` is the door.
  // ===============================================================================================

  // --- Two bottom values, and they are strictly distinguishable. -------------------------------
  //
  // NOTE the `(let v ...)` in each of these. It is not stylistic. A `when`/`if`/`cond` written
  // DIRECTLY as a call argument -- `(console.log (when false 1))` -- emits invalid JavaScript and
  // trips LL0101: a `let` initializer is an expression context and a call argument is not, so the
  // branch is emitted as a statement. That is a P5 leftover, unrelated to nil, and it is LOUD rather
  // than silent. Surfaced as an open finding, not absorbed here.
  {
    name: "nil catches the bottom the compiler itself emits (when)",
    source: `(let v (when false 1))
(console.log (== v nil))`,
    expect: ["true"],
    wasBroken:
      "FALSE. `when`-false emits `undefined` while `nil` emits `null`, and __ll_deep_eq opens with " +
      "`a === b` -- so the language cannot detect the bottom value it produces itself",
  },
  {
    name: "nil catches the bottom the compiler itself emits (if, no else)",
    source: `(let v (if false 1))
(console.log (== v nil))`,
    expect: ["true"],
    wasBroken: "FALSE -- the same two-bottom split, reached through the if-without-else path",
  },
  {
    name: "there is ONE bottom value, and it prints as one thing",
    source: `(let a (when false 1))
(let b (if false 1))
(console.log a b nil)`,
    expect: ["null null null"],
    wasBroken: "`undefined undefined null` -- two bottoms, visible in the output",
  },
  {
    name: "nil is not equal to the falsy values",
    source: `(console.log (== nil nil) (== 0 nil) (== "" nil) (== false nil))`,
    expect: ["true false false false"],
    wasBroken:
      "not broken -- a GUARD on D9b. The loose-null clause (`a == null && b == null`) is the one " +
      "place a JS `==` sneaks in; it must not drag 0, \"\" or false along with it",
  },

  // --- The runtime does not know what nil is. --------------------------------------------------
  // A `nil` pattern is the sharpest frontend divergence in the tree, and neither half is what the
  // audit predicted from reading the runtime source.
  //
  //   grammar_v2: PARSE ERROR -- "Expecting RBracket but found 'nil'". Loud, at least.
  //   PEG:        emits `let nil; ... (nil = tmp[0], true) ...` -- it parses `nil` as a BINDING
  //               VARIABLE NAMED `nil`, which matches ANYTHING and shadows the literal. Silent.
  //
  // The predicted bug -- __ll_match_list's `if (pattern === null) continue; // Wildcard` -- is real
  // in the shim text but CANNOT FIRE: nothing in the codegen ever calls __ll_match_list or
  // __ll_match_struct. They are dead code. Vector patterns are inlined (`_` becomes `&& true`).
  // Written from the source, that finding looked live; the harness says otherwise. Hence the harness.
  {
    name: "a nil pattern TESTS for nil -- it does not match everything",
    source: `(let v [1 2])
(console.log (match v { [nil 2] => "matched-nil" _ => "other" }))`,
    expect: ["other"],
    wasBroken:
      "grammar_v2: parse error. PEG: prints \"matched-nil\" -- it bound a VARIABLE named `nil` to the " +
      "value 1 and matched unconditionally. The two frontends disagree, and one of them is silent",
  },
  {
    name: "a nil pattern DOES match an actual nil",
    source: `(let v [nil 2])
(console.log (match v { [nil 2] => "matched-nil" _ => "other" }))`,
    expect: ["matched-nil"],
    wasBroken:
      "grammar_v2: parse error. PEG: right answer, wrong reason -- it matches everything, so it also " +
      "'matches' a nil. Examples 19 and 21 both lean on nil patterns",
  },
  {
    name: "head of an empty array is nil, not the array",
    source: `(console.log (== (head []) nil))`,
    expect: ["true"],
    wasBroken:
      "FALSE -- `head` returns THE ARRAY ITSELF when empty: `a.length > 0 ? a[0] : a`. " +
      "DECISIONS.md:84 cites exactly this as why D9 must come before a typed stdlib",
  },
  {
    name: "empty sees a nil",
    source: `(console.log (empty nil))`,
    expect: ["true"],
    wasBroken: "FALSE -- `empty` checks `a === undefined` only, and is blind to null",
  },

  // --- Spellings. `nil` is the one; `null` the JS-interop alias; the other three are deleted. ---
  {
    name: "`undefined` is not a spelling of nil",
    source: `(let x undefined)
(console.log x)`,
    expectDiagnostic: /LL0210/,
    wasBroken:
      "compiled, and emitted the JS identifier `undefined` -- the SECOND bottom value. Note it is " +
      "also in JS_GLOBALS, so merely dropping it from NilKw silently re-admits it as a global with " +
      "zero diagnostics. Both have to go",
  },
  {
    name: "`none` is not a spelling of nil",
    source: `(let x none)
(console.log x)`,
    expectDiagnostic: /LL0210/,
    wasBroken: "compiled, and emitted `null` -- a third spelling of the same value",
  },
  {
    name: "`void` is not a spelling of nil",
    source: `(let x void)
(console.log x)`,
    expectDiagnostic: /LL0210/,
    wasBroken: "compiled, and emitted `null` -- a fourth spelling",
  },
  {
    name: "`null` survives as the JS-interop alias",
    source: `(console.log (== nil null))`,
    expect: ["true"],
    wasBroken:
      "not broken -- a guard. The ruling keeps `null` as an alias; it must remain the SAME value",
  },
  {
    name: "`Void` the TYPE survives the deletion of `void` the spelling",
    source: `(fn shout [] -> Void (console.log "hi"))
(shout)`,
    expect: ["hi"],
    wasBroken:
      "not broken -- a guard, and a live frontend divergence: NilKw is case-SENSITIVE in grammar_v2 " +
      "and case-INSENSITIVE in the PEG, so `Void` is an Identifier in one and a nil keyword in the other",
  },

  // --- T? -- the door. --------------------------------------------------------------------------
  {
    name: "T? parses, and accepts nil",
    source: `(let x <- String? nil)
(console.log x)`,
    expect: ["null"],
    wasBroken:
      "NOT a parse error, which is what I expected and is why the case got written. `?` is absent " +
      "from the type grammar, so the annotation ends at `String` and the stray `?` is taken as an " +
      "operator-identifier -- the program COMPILES and dies at run time with " +
      "`ReferenceError: _3f is not defined`. A silent miscompile, not a refusal",
  },
  {
    name: "T? accepts a value too (T widens to T?)",
    source: `(let x <- String? "hi")
(console.log x)`,
    expect: ["hi"],
    wasBroken:
      "same `_3f` ReferenceError. `T -> T?` must WIDEN -- an optional is not a nil-only slot",
  },
  {
    name: "T? is NOT T -- the unwrap is forced",
    source: `(let a <- String? "hi")
(let b <- String a)`,
    expectDiagnostic: /LL0200.*String\?.*String/,
    wasBroken:
      "unparseable. Note the message must SAY `String?` -- formatType had no optional branch, so this " +
      "would have read 'cannot assign String to String', which is not an error message, it is a koan",
  },
  {
    name: "an optional array is T[]?, and a spaced `?` is not optionality at all",
    source: `(mut xs <- Int[]? nil)
(console.log xs)`,
    expect: ["null"],
    wasBroken:
      "unparseable. `?` binds OUTSIDE `[]`, so `T[]?` is an optional array and an array of optionals " +
      "is `(T?)[]`. Adjacency-gated exactly like the `[]` suffix: `String?` is optional, `String ?` " +
      "is a String followed by something else. The PEG could not make that distinction at all until " +
      "TypeName stopped eating the whitespace in front of its own suffixes",
  },
  {
    name: "T is non-nullable -- and already was",
    source: `(let x <- String nil)
(console.log x)`,
    expectDiagnostic: /LL0200/,
    wasBroken:
      "not broken -- a GUARD, and the finding that reframed D9. I planned this as a tightening and " +
      "had it backwards: nothing ever sets `nullable` on a target, so isAssignable(Null, String) is " +
      "already false. The cage was always shut. D9 builds the door",
  },
  {
    name: "an annotated binding keeps its DECLARED type, not its value's",
    source: `(defclass Animal (fn speak [] -> String (return "...")))
(defclass Dog :extends Animal (fn speak [] -> String (return "woof")))
(defclass Cat :extends Animal (fn speak [] -> String (return "meow")))
(mut pet <- Animal (Dog))
(pet := (Cat))
(console.log (pet.speak))`,
    expect: ["meow"],
    wasBroken:
      "LL0202, a FALSE POSITIVE: the let-check binds the VALUE type (`Dog`) and throws the annotation " +
      "away, so assigning a Cat to an Animal-declared binding reads as 'Cat is not a Dog'. The same " +
      "line kills optionals -- `(let x <- String? nil)` would bind `Null`, not `String?`, so T? " +
      "could not survive its own declaration",
  },

  // --- The indexer is PARTIAL: absence is an error, not a value. `get` is the total form. -------
  {
    name: "an out-of-bounds index THROWS",
    source: `(let xs [1 2 3])
(console.log xs[9999])`,
    expectThrow: /IndexOutOfRange/,
    wasBroken:
      "printed `undefined` -- a hole straight through the type system. `xs[i]` is typed `Int` and " +
      "hands you a bottom value. An out-of-bounds index is a BUG, and a bug must be loud",
  },
  {
    name: "an absent map key THROWS",
    source: `(let m {"host" "localhost"})
(console.log m["absent"])`,
    expectThrow: /KeyError/,
    wasBroken: "printed `undefined` -- typed `String`, and not a String",
  },
  {
    name: "an in-bounds read still works",
    source: `(let xs [1 2 3])
(let m {"host" "localhost"})
(console.log xs[0] xs[2] m["host"])`,
    expect: ["1 3 localhost"],
    wasBroken: "not broken -- a guard. The bounds check must not cost a correct read its answer",
  },
  {
    name: "writing to an absent key CREATES it",
    source: `(mut m {})
(m["k"] := 1)
(console.log m["k"])`,
    expect: ["1"],
    wasBroken:
      "not broken -- a guard. The indexer is partial for READS only. A write that refused to create " +
      "would make every map build-up impossible",
  },
  {
    name: "(get c k) is TOTAL, and answers nil",
    source: `(let xs [1 2 3])
(let m {"host" "localhost"})
(console.log (get xs 9999) (get m "absent") (get xs 0))`,
    expect: ["null null 1"],
    wasBroken:
      "`undefined undefined 1`. After D9 this is the ONLY way to ask 'is it there?' -- and it is what " +
      "gives T? a PRODUCER. Without it, an optional only ever arises where someone typed a `?`",
  },
  {
    name: "the memoization idiom: absence is asked with `get`, not by indexing",
    source: `(mut memo {})
(fn fib [n <- Int] -> Int (
  (let cached (get memo n))
  (if (!= cached nil) (return cached))
  (if (<= n 1) (return n))
  (let r (+ (fib (- n 1)) (fib (- n 2))))
  (memo[n] := r)
  (return r)))
(console.log (fib 30))`,
    expect: ["832040"],
    wasBroken:
      "the corpus spells this `(!= memo[n] undefined)` -- which after D9f THROWS on the first, " +
      "uncached call. This is the migration the four memoization files have to make, and it is only " +
      "CORRECT once D9b's loose-null clause has landed: otherwise `(!= (get memo n) nil)` reads " +
      "'cached' for an absent key and memoized fib silently returns undefined",
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
  let diagnostics: string[] = [];
  try {
    const context = new Context(lispPath, options);
    const result: any = context.process(lispPath);

    diagnostics = context.results.all
      .filter((m: any) => String(m.code).startsWith("LL"))
      // The WHOLE message, flattened -- not `.split("\n").pop()`, which kept only the LAST line and
      // was usually the empty one. Every expectDiagnostic here could therefore only ever match the
      // CODE; asserting on the message TEXT silently could not work. D9's forced unwrap is the first
      // case that needs to (the point of `T? -> T` is that the message SAYS `String?`), which is how
      // this surfaced at all.
      .map((m: any) => {
        const text = String(m.message)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .join(" ");
        return `${m.code}: ${text}`;
      });

    if (c.expectDiagnostic) {
      const hit = diagnostics.some((d) => c.expectDiagnostic!.test(d));
      return hit
        ? { ok: true, detail: "" }
        : {
            ok: false,
            detail: `expected ${c.expectDiagnostic}, got ${
              diagnostics.length ? diagnostics.map((d) => d.slice(0, 70)).join(" | ") : "NO diagnostic (it compiled silently)"
            }`,
          };
    }

    // A reported error blocks emission -- report it as the failure, with its code, so an LL0100 or
    // LL0101 names itself rather than surfacing as a mystery.
    if (context.results.hasErrors) {
      return {
        ok: false,
        detail: `compile reported: ${diagnostics.map((d) => d.slice(0, 88)).join(" | ") || "(errors)"}`,
      };
    }
    code = result?.code ?? "";
  } catch (e: any) {
    if (c.expectDiagnostic) {
      // A raw parse CRASH is not a located diagnostic. That distinction is the point of D3's
      // "never a silent call" -- and equally, never an unlocated one.
      return {
        ok: false,
        detail: `expected ${c.expectDiagnostic}, but the compiler THREW: ${String(e.message)
          .split("\n")[0]
          .slice(0, 76)}`,
      };
    }
    return { ok: false, detail: `compile threw: ${String(e.message).split("\n")[0].slice(0, 96)}` };
  }

  // Assertions on the emitted TEXT -- for correctness that is invisible at run time.
  for (const re of c.emitted?.must ?? []) {
    if (!re.test(code)) {
      return { ok: false, detail: `emitted JS must match ${re}, and does not`, js: code };
    }
  }
  for (const re of c.emitted?.mustNot ?? []) {
    if (re.test(code)) {
      return { ok: false, detail: `emitted JS must NOT match ${re}, but does`, js: code };
    }
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
    if (c.expectThrow) {
      return c.expectThrow.test(String(proc.stderr))
        ? { ok: true, detail: "" }
        : { ok: false, detail: `expected a throw matching ${c.expectThrow}, got: ${blame.trim().slice(0, 76)}`, js: code };
    }
    return { ok: false, detail: `RUNTIME ERROR: ${blame.trim().slice(0, 96)}`, js: code };
  }
  if (c.expectThrow) {
    return {
      ok: false,
      detail: `expected a throw matching ${c.expectThrow}, but it exited 0 and printed ${JSON.stringify(
        String(proc.stdout).trim()
      )}`,
      js: code,
    };
  }

  const actual = String(proc.stdout).trim().split("\n").map((l) => l.trim()).filter(Boolean);
  const expected = c.expect ?? [];
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

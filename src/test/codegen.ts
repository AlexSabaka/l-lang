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
import { CHILD_ENV } from "./childEnv";
import { Context, CompilerOptions, LogLevel } from "../compiler/Context";

const VERBOSE = process.argv.includes("--verbose");
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
   * The case must compile and run as usual, and must NOT report this diagnostic.
   *
   * The counterpart `expectDiagnostic` could not express, and the gap was silent. A WARNING does not
   * block emission, so a case that merely asserts `expect` passes whether or not the warning fired --
   * "it does not warn here" was, by construction, an untestable claim written in a comment. Any hint
   * precise enough to be worth shipping needs its FALSE-POSITIVE guard to be a real assertion.
   */
  mustNotDiagnose?: RegExp;
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
    // `(obj.m)` with no arguments is a call or a property read, and codegen decides by asking the
    // symbol table what type `obj` is. That lookup was FLAT, so for a LOCAL receiver it found
    // nothing and fell through to a blacklist of names that "aren't methods" -- which contains
    // `name`. So this emitted `d.name`, printing the function object instead of calling it.
    //
    // Everything shields this: a receiver at top level resolves flat anyway, and a method whose
    // class is declared BEFORE the call is caught by the `isKnownFunction` heuristic. It takes a
    // local receiver, a blacklisted method name, and a class declared after, all at once -- so the
    // corpus never hits it, and the emitted JS for all 97 files is byte-identical after the fix.
    // Unexercised is not the same as dead.
    // `(new Dog)` and not `(Dog)`, deliberately -- and the reason is now HISTORY: a class used before
    // its declaration used to emit a reference to the class rather than an instance
    // (`__ll_copy(Dog)`), because codegen decided "is this a constructor call" from a list of classes
    // it had visited SO FAR. That was a separate bug, registered rather than absorbed, and writing
    // this case the obvious way would have made it look like this one. Fa fixed it -- the decision
    // asks the symbol table now -- so both spellings work. The `new` is kept: the case is about a
    // zero-arg METHOD, and it should not depend on a fix made elsewhere.
    name: "a zero-arg method on a LOCAL receiver is CALLED, not read",
    source: `(fn go [] -> Void (
    (let d (new Dog))
    (console.log (d.name))
))
(defclass Dog (fn name [] -> String (return "Rex")))
(go)`,
    expect: ["Rex"],
    wasBroken: "emitted `d.name` -- a property read -- so it printed [Function: name] instead of calling it",
  },
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

  {
    // Tg: the per-node TYPE CHANNEL. Codegen can ask "is this a struct?" instead of guessing.
    //
    // `__ll_copy` is D11's value semantics: a struct is copied on the way into a binding. Codegen had
    // no type information at all -- `typeEnv` was assigned in Context.ts and never read -- so it
    // wrapped EVERY value on the chance it might be a struct, and let the runtime marker check decide.
    // In a program with no struct types anywhere, every one of those calls is provably dead.
    //
    // The asymmetry is deliberate and must stay: a type proving NOT-a-struct elides the copy; NO type
    // keeps it. An empty channel must never read as "not a struct" -- that turns a missing type into
    // an aliasing bug.
    name: "a program with no structs emits no __ll_copy",
    source: `(fn add [a <- Int b <- Int] -> Int (+ a b))
(let x <- Int (add 2 3))
(console.log x)`,
    expect: ["5"],
    // The CALL shapes, not the bare name -- the runtime shim necessarily contains `__ll_copy(` in its
    // own definition and in `__ll_copy_each`. These two are what codegen used to emit here:
    //     const x = __ll_copy(add(2, 3));   return __ll_copy(_2b(a, b));
    emitted: { mustNot: [/__ll_copy\(add\(/, /__ll_copy\(_2b\(/] },
    wasBroken: "codegen had no type channel, so it wrapped every value on the chance it was a struct",
  },
  {
    // ...and the guard for the other direction: a STRUCT still gets copied. The elision must never
    // reach a value that can actually carry the marker.
    name: "a struct is still copied on the way into a binding",
    source: `(defstruct P (mut :ctor x <- Int 0))
(let a (P 1))
(let b a)
(b.x := 99)
(console.log a.x b.x)`,
    expect: ["1 99"],
    emitted: { must: [/__ll_copy\(/] },
    wasBroken: "not broken -- the guard that stops the type channel from eliding a REAL copy",
  },
  {
    // D17. `(x |> (.m a))` is a METHOD CALL on the piped value -- `x.m(a)` -- not a free call
    // `m(x, a)`.
    //
    // It used to be the latter, and there was no way to notice: codegen's member test was
    // `simple-identifier && id.startsWith(".")`, while the parser produces a `composite-identifier`
    // whose `id` has no leading dot. Doubly dead, never once fired. `05_matching.lisp` only worked
    // because it defines `(fn apply [acc e] (acc.apply e))` BY HAND -- a free function whose only job
    // is to undo the mis-desugaring. Written without that shim, as here, the pipeline reported
    // `LL0210: 'add' is not defined` on a method that plainly exists.
    name: "D17: a `(.m a)` pipeline stage is a METHOD call",
    source: `(defclass Acc
    (mut :ctor v <- Int 0)
    (fn add [n <- Int] -> Acc (
        (this.v := (+ this.v n))
        (return this)
    )))
(let a (new Acc 0))
(let r (a |> (.add 5) |> (.add 3)))
(console.log r.v)`,
    expect: ["8"],
    emitted: { must: [/a\.add\(5\)\.add\(3\)/] },
    wasBroken: "desugared to the free call `add(a, 5)`, so it needed a hand-written free `add` to work at all",
  },

  // --- :comptime. It FOLDS -- see the retraction in DECISIONS.md. The gap is that a fold which
  // FAILS degrades silently to run time. ---
  {
    // The comptime pass never RECURSES into an `if` / `while` / `for` / `match` body: its dispatch
    // tests `(this as any)['visit' + Type]`, and BaseAstVisitor defines one of those for EVERY node
    // type, so it always resolves -- to an inherited NO-OP. Its own generic-recursion fallback is
    // unreachable.
    //
    // So the fold does not happen; the call is emitted; and then the tree-shaker DELETES `twice`,
    // because a `:comptime` function is supposed to have been folded away. Zero diagnostics, and a
    // guaranteed `ReferenceError: twice is not defined` at run time. `DesugarAstVisitor` has the
    // identical dispatch, which is why it reaches only `program`, `list` and `function`.
    name: "comptime: a fold inside an `if` body still folds",
    source: `(fn :comptime twice [n <- Int] -> Int (* n 2))
(if true (
    (let folded (twice 21))
    (console.log folded)
) nil)`,
    expect: ["42"],
    emitted: { mustNot: [/function twice|const twice/] },
    wasBroken: "the fold never ran inside the `if`, the tree-shaker deleted `twice`, and it threw ReferenceError",
  },
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
  // --- The unwrap is FORCED (D9g). An optional you never check is the bug optionals exist to stop.
  {
    name: "a possibly-nil value cannot be dereferenced",
    source: `(let xs <- String[] ["abc"])
(let h (head xs))
(console.log h.length)`,
    expectDiagnostic: /LL0205/,
    wasBroken:
      "compiled, and `h.length` on an empty array is a TypeError at run time -- the null-dereference " +
      "this entire ruling exists to make unsayable. `T?` without a forced unwrap is a comment",
  },
  {
    name: "narrowing: a nil-check unwraps it",
    source: `(let xs <- String[] ["abc"])
(let h (head xs))
(if (!= h nil) (console.log h.length))`,
    expect: ["3"],
    wasBroken:
      "there is NO narrowing anywhere in the compiler -- visitIf visits both branches with the " +
      "environment untouched. Without it LL0205 has no escape hatch, and `T?` becomes unusable " +
      "rather than merely unsafe: the check you just wrote would not be believed",
  },
  {
    name: "narrowing: an early-return guard unwraps the REST of the block",
    source: `(fn first-len [xs <- String[]] -> Int (
  (let h (head xs))
  (if (== h nil) (return 0))
  (return h.length)))
(console.log (first-len ["abcd"]))
(console.log (first-len []))`,
    expect: ["4", "0"],
    wasBroken:
      "the guard-and-return is the shape the corpus actually writes (19_optional_and_mutability, " +
      "21_nil_handling), and it narrows nothing without flow-sensitivity across a block",
  },
  {
    name: "narrowing does NOT leak past the branch",
    source: `(let xs <- String[] ["abc"])
(let h (head xs))
(if (!= h nil) (console.log h.length))
(console.log h.length)`,
    expectDiagnostic: /LL0205/,
    wasBroken:
      "a guard on the narrowing: outside the branch that checked it, `h` is optional again. An " +
      "over-eager narrowing is worse than none -- it would report nothing while proving nothing",
  },
  {
    name: "arithmetic on a possibly-nil value",
    source: `(let xs [1 2 3])
(let n (head xs))
(console.log (+ n 1))`,
    expectDiagnostic: /LL0205/,
    wasBroken:
      "`Int?` is still NAMED Int, so isNumeric said yes and `(+ nil 1)` sailed through to produce " +
      "the string \"null1\" or NaN at run time",
  },
  {
    name: "comparing an optional to nil is ALWAYS allowed",
    source: `(let xs <- String[] [])
(let h (head xs))
(console.log (== h nil) (!= h nil))`,
    expect: ["true false"],
    wasBroken:
      "not broken -- a GUARD, and the one exemption LL0205 must carve out. `(== h nil)` is how you " +
      "DISCHARGE the obligation; if the check itself were an error the feature would eat its own tail",
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

  // ===============================================================================================
  // D11 -- the class surface   (DECISIONS.md:120-131)
  //
  // "Visibility is TYPE-CHECK-ONLY and ERASED at codegen -- no `#private` emission. `:extends` only.
  //  `defstruct` becomes a real value type."
  //
  // (Value semantics is a separate phase. This one is the class SURFACE.)
  // ===============================================================================================

  // --- `:private` is a silent wrong answer in the most ordinary OOP code there is. --------------
  {
    name: ":private field -- a counter that counts",
    source: `(defclass Counter
  (let :private count 0)
  (fn bump [] -> Int (this.count := (+ this.count 1)) (return this.count)))
(let c (Counter))
(console.log (c.bump))
(console.log (c.bump))`,
    expect: ["1", "2"],
    emitted: {
      // D11 rules visibility ERASED at codegen. No `#` may survive anywhere.
      mustNot: [/#count/],
    },
    wasBroken:
      "NaN, twice, with zero diagnostics. The field is DECLARED `#count = 0` (JSClassBuilder emits a " +
      "PrivateIdentifier for `:private`) and every read/write emits `this.count` -- visitCompositeIdentifier " +
      "knows nothing about visibility. Two disconnected code paths that never meet: the `#` slot keeps " +
      "its initializer forever, `this.count` is undefined, and undefined + 1 is NaN",
  },
  {
    name: ":private is still readable from INSIDE the class",
    // NOTE the `(let v (Vault))`. `((Vault).reveal)` -- a method call directly on a parenthesised
    // expression -- emits INVALID JavaScript (LL0101). Loud, not silent, unrelated to visibility, and
    // surfaced as an open finding rather than absorbed here.
    source: `(defclass Vault
  (let :private secret 42)
  (fn reveal [] -> Int (return this.secret)))
(let v (Vault))
(console.log (v.reveal))`,
    expect: ["42"],
    wasBroken:
      "returned undefined -- `#secret = 42` was declared and `this.secret` was read. The same split",
  },
  {
    name: ":private is NOT readable from outside the class",
    source: `(defclass Vault (let :private secret 42))
(let v (Vault))
(console.log v.secret)`,
    expectDiagnostic: /LL0206/,
    wasBroken:
      "compiled silently. `:private` was enforced NOWHERE -- `Symbol.visibility` is computed correctly " +
      "(SymbolTable.ts:661) and read by literally nothing, which is D10's `mutable: false` pathology " +
      "verbatim. The only visibility diagnostic that exists is LL0022, and it merely rejects TWO " +
      "visibility modifiers on one declaration",
  },
  {
    name: ":public members stay reachable (guard)",
    source: `(defclass Open (let :public value 7))
(let o (Open))
(console.log o.value)`,
    expect: ["7"],
    wasBroken: "not broken -- a guard. LL0206 must refuse `:private` and nothing else",
  },

  // --- Reflection reports the opposite of what codegen does. -------------------------------------
  {
    name: "reflection tells the truth about :private",
    source: `(defclass Box (let :private secret 1) (let :public open 2))
(let b (Box))
(let m (type b))
(console.log (JSON.stringify m.properties))`,
    expect: [
      '[{"name":"secret","type":"Any","isPublic":false,"isPrivate":true,"isStatic":false},' +
        '{"name":"open","type":"Any","isPublic":true,"isPrivate":false,"isStatic":false}]',
    ],
    wasBroken:
      "reported `isPublic:true, isPrivate:false` for a `:private` field -- so codegen called it PRIVATE " +
      "(emitting `#secret`) while reflection called it PUBLIC. D11's own text says the disagreement is " +
      "`:static` hardcoded false vs reflection reporting true; it is neither. InferTypesAstVisitor:832-838 " +
      "compares `mod === ':private'` WITH a colon, and both parsers STRIP it -- so all seven comparisons " +
      "are dead and visibility/isStatic/isConstructorParam/isOperator never leave their defaults",
  },

  // --- `:static` ---------------------------------------------------------------------------------
  {
    name: ":static is a static member",
    source: `(defclass MathUtil (fn :static twice [n <- Int] -> Int (return (* n 2))))
(console.log (MathUtil.twice 21))`,
    expect: ["42"],
    wasBroken:
      "TypeError: MathUtil.twice is not a function -- it was emitted as an INSTANCE method. `static:` is " +
      "hardcoded `false` at all three ESTree sites (JSClassBuilder:333, :356; JSTransformerAstVisitor:951) " +
      "and nothing in codegen ever reads the `:static` modifier",
  },

  // --- `defstruct` has no class surface at all. ---------------------------------------------------
  {
    name: "defstruct :implements parses, and satisfies the interface",
    source: `(definterface Shape (fn area [] -> Int))
(defstruct Rect :implements Shape
  (let :ctor w <- Int 0)
  (fn area [] -> Int (return (* this.w this.w))))
(fn describe [s <- Shape] -> Int (return (s.area)))
(let r (Rect 5))
(console.log (describe r))`,
    expect: ["25"],
    wasBroken:
      "grammar_v2: PARSE ERROR (\"Expecting RParen but found ':implements'\") -- that IS the last ERROR " +
      "in the suite, examples/05-oop/01_interfacses.lisp. The PEG is WORSE: it parses, and dumps the " +
      "`:implements Shape` clause into the struct BODY as two junk bare identifiers. A divergence where " +
      "the silent frontend is the one that 'works'. And even once it parses, a struct's InferredType " +
      "never gets `implementedInterfaces`, which isSubtype WALKS -- so a struct could still never satisfy " +
      "an interface",
  },
  {
    name: "(type s) on a struct says struct",
    source: `(defstruct Point (let :ctor x <- Int 0))
(let p (Point 3))
(let m (type p))
(console.log m.kind)`,
    expect: ["struct"],
    wasBroken:
      "'object'. A struct never gets `codegenMetadata` (CollectTypesPass.visitStruct builds only " +
      "{kind, name, members, ctorInfo}), so it is absent from __ll_type_metadata entirely and `type` " +
      "falls through to its runtime constructor-name guess",
  },

  // --- The live inheritance path must not regress. -----------------------------------------------
  {
    name: ":extends inheritance still works (guard)",
    source: `(defclass Animal (fn speak [] -> String (return "...")))
(defclass Dog :extends Animal (fn speak [] -> String (return "woof")))
(let d (Dog))
(console.log (d.speak))`,
    expect: ["woof"],
    wasBroken:
      "not broken -- a guard. Three passing goldens ride the `:extends` path. (`:inherits` is NOT a " +
      "synonym and never was: it exists only inside a `:where T :inherits Base` CONSTRAINT, so the " +
      "grammar has always agreed with D11 -- it is the README and the reference doc that are wrong)",
  },

  // ===============================================================================================
  // STRUCT VALUE SEMANTICS   (D11: "`defstruct` becomes a real value type: by-copy semantics")
  //
  // `visitStruct` is `return this.visitClass(node)`, so a struct IS a class and assignment ALIASES.
  //
  // THE CORPUS CANNOT SEE THIS PHASE, AND CANNOT SEE THE WAY IT WOULD GO WRONG. Every passing struct
  // golden -- 06_structs, 04_enums, 08_operators, 09_operators, 01_interfacses, complex_math_test --
  // has ALL-PRIMITIVE fields (every one is Real or Int). A shallow copy gives correct value semantics
  // for exactly that set and silently keeps aliasing everything else. A green suite would have proved
  // nothing. These cases are the only thing standing between the ruling and a lie.
  // ===============================================================================================

  {
    name: "value semantics: assignment COPIES a struct",
    source: `(defstruct P (mut :ctor x <- Int 0))
(mut a (P 1))
(mut b a)
(b.x := 99)
(console.log a.x b.x)`,
    expect: ["1 99"],
    wasBroken: "`99 99` -- a struct is a class, so `(mut b a)` aliased it",
  },
  {
    name: "value semantics: a struct FIELD copies, a reference field SHARES",
    source: `(defstruct Inner (mut :ctor n <- Int 0))
(defstruct Outer (let :ctor i <- Inner) (let :ctor xs <- Int[]))
(mut a (Outer (Inner 1) [7 8]))
(mut b a)
(b.i.n := 99)
(b.xs[0] := 99)
(console.log a.i.n a.xs[0])`,
    // BOTH halves of the ruling, in one case, and the corpus contains NOTHING like it.
    //   a.i.n  -> 1   the nested STRUCT was copied         (memberwise, recursing into structs)
    //   a.xs[0]-> 99  the ARRAY was SHARED, not copied      (reference types are shared -- the C# rule)
    // The second half is asserted deliberately: it pins the ruling so that a later, well-meaning
    // "make the copy deep" cannot drift in without this going red and someone having to argue for it.
    expect: ["1 99"],
    wasBroken:
      "`99 99` -- and a SHALLOW copy would have printed `99 99` too, for the nested struct. This is the " +
      "case that decides whether by-copy is real or is a lie that every golden agrees with",
  },
  {
    name: "value semantics: a struct is passed BY VALUE",
    source: `(defstruct P (mut :ctor x <- Int 0))
(fn bump [p <- P] -> Int ((p.x := 100) (return p.x)))
(mut a (P 1))
(console.log (bump a) a.x)`,
    expect: ["100 1"],
    wasBroken: "`100 100` -- the callee mutated the caller's struct",
  },
  {
    name: "value semantics: a struct in an array literal is a copy",
    source: `(defstruct P (mut :ctor x <- Int 0))
(mut a (P 1))
(let xs [a])
(a.x := 99)
(console.log xs[0].x a.x)`,
    expect: ["1 99"],
    wasBroken: "`99 99` -- the array held the SAME object",
  },
  {
    name: "value semantics: `for :each` binds a copy",
    source: `(defstruct P (mut :ctor x <- Int 0))
(let ps [(P 1) (P 2)])
(for :each p :from ps :then (p.x := 99))
(console.log ps[0].x ps[1].x)`,
    expect: ["1 2"],
    wasBroken:
      "`99 99` -- visitForEach emits a ForOfStatement whose loop variable is a plain identifier, so it " +
      "binds each element BY REFERENCE. Not a let/assign/arg/literal site; easy to miss entirely",
  },
  {
    name: "value semantics: a method still mutates its receiver",
    source: `(defstruct C (mut :ctor n <- Int 0)
  (fn bump [] -> Int ((this.n := (+ this.n 1)) (return this.n))))
(mut c (C 0))
(c.bump)
(c.bump)
(console.log c.n)`,
    expect: ["2"],
    wasBroken:
      "not broken -- THE guard on this phase. `this` must NOT be a copy: construct-mutate-return is the " +
      "corpus's only way to build a struct (~30 sites in std/math and 09_operators). Copy the receiver " +
      "and every one of them silently returns an unmutated value",
  },
  {
    name: "a defclass still ALIASES (guard)",
    source: `(defclass Box (mut :ctor v <- Int 0))
(let a (Box 1))
(let b a)
(b.v := 99)
(console.log a.v b.v)`,
    expect: ["99 99"],
    wasBroken:
      "not broken -- a guard, and the other half of the ruling. A class is a REFERENCE type. If the copy " +
      "fires on classes too, value semantics has simply been applied to the whole language",
  },
  {
    name: "a struct :operator may not mutate `this`",
    source: `(defstruct W (mut :ctor n <- Int 0)
  (fn :operator * [k <- Int] -> W ((this.n := (* this.n k)) (return this))))`,
    expectDiagnostic: /LL0207/,
    wasBroken:
      "compiled silently, and the mutation ESCAPES: the runtime routes `(* w 2)` to `w['*_1'](2)`, so " +
      "`this` IS the caller's struct. Under pass-by-value a mutating operator is incoherent -- in C# an " +
      "operator is static and takes its operands by value. 07_structs does exactly this",
  },

  // ===============================================================================================
  // W -- four silent wrong answers. Programs that compile clean and do the wrong thing.
  // ===============================================================================================

  // --- Destructuring binds by reference. The hole value semantics left behind. -------------------
  {
    name: "destructuring COPIES a struct",
    source: `(defstruct P (mut :ctor x <- Int 0))
(let ps [(P 1) (P 2)])
(let [a b] ps)
(a.x := 99)
(console.log ps[0].x a.x)`,
    expect: ["1 99"],
    wasBroken:
      "`99 99`. Value semantics copies at every inflow EXCEPT this one: visitVariable wraps the " +
      "initializer in __ll_copy, but for a destructuring binding the initializer is the ARRAY -- which " +
      "carries no struct marker, so the copy is a no-op that LOOKS like a fix and passes review",
  },
  {
    name: "destructuring in `for :each` COPIES too",
    source: `(defstruct P (mut :ctor x <- Int 0))
(let pairs [[(P 1) (P 2)]])
(for :each [a b] :from pairs :then (a.x := 99))
(console.log pairs[0][0].x)`,
    expect: ["1"],
    wasBroken: "`99` -- the same hole, reached through the loop's pattern binding",
  },

  // --- A compound assignment never reaches the operator shim. -------------------------------------
  {
    name: "`+=` finds the operator overload",
    source: `(defstruct C (let :ctor r <- Int 0))
(fn :operator + [a <- C b <- C] -> C (return (C (+ a.r b.r))))
(mut z (C 1))
(z += (C 2))
(console.log z.r)`,
    expect: ["3"],
    wasBroken:
      "`undefined`. visitCompoundAssignment emits `node.operator.replace(':', '')` -- raw JS `z += ...` " +
      "-- which never touches the `+` shim, so no overload is ever found. On a struct that is " +
      "object + object: `[object Object][object Object]`, or undefined",
  },
  {
    name: "`+=` on a number still works (guard)",
    source: `(mut n 1)
(n += 2)
(console.log n)`,
    expect: ["3"],
    wasBroken: "not broken -- a guard. Desugaring `+=` must not break the arithmetic it already does",
  },
  {
    name: "`:=` is still a plain assignment (guard)",
    source: `(mut n 1)
(n := 2)
(console.log n)`,
    expect: ["2"],
    wasBroken: "not broken -- a guard. `:=` maps to `=` and must NOT be desugared through an operator",
  },

  // --- A two-parameter :operator METHOD is dead code. ---------------------------------------------
  {
    name: "a 2-param :operator METHOD is refused",
    source: `(defstruct V (let :ctor x <- Int 0)
  (fn :operator + [u <- V v <- V] -> V (return (V (+ u.x v.x)))))`,
    expectDiagnostic: /LL0208/,
    wasBroken:
      "compiled, emitted `+_2` (name + arity), and was NEVER CALLED -- the runtime shim probes `+_1`. " +
      "Dead code, silently. Inside a type an operator takes ONE parameter, because `this` IS the left " +
      "operand; a two-param method leaves `this` bound and meaningless. The arity suffix itself cannot " +
      "just be dropped -- 08_operators declares both `- [other]` and `- []`, which would collide",
  },
  {
    name: "a 1-param :operator METHOD still works (guard)",
    source: `(defstruct C (let :ctor r <- Int 0)
  (fn :operator + [other <- C] -> C (return (C (+ this.r other.r)))))
(let z (+ (C 1) (C 2)))
(console.log z.r)`,
    expect: ["3"],
    wasBroken:
      "not broken -- a guard, and the form std/math and 08_operators actually use. `this` is the left " +
      "operand; the method emits `+_1`, which is what the shim probes",
  },
  {
    name: "a top-level 2-param operator still works (guard)",
    source: `(defstruct C (let :ctor r <- Int 0))
(fn :operator + [a <- C b <- C] -> C (return (C (+ a.r b.r))))
(let z (+ (C 1) (C 2)))
(console.log z.r)`,
    expect: ["3"],
    wasBroken:
      "not broken -- a guard, and the form 06_structs, 09_operators and 10_value_semantics use. It " +
      "registers in __ll_op_registry. LL0208 must refuse the METHOD form and leave this one alone",
  },

  // ===============================================================================================
  // Sd -- `:extern`. An ambient global is DECLARED, never DEFINED.
  //
  // These live here rather than in test:type-errors for a reason worth stating: that harness collects
  // only `LL02*` codes, so `:extern`'s actual failure -- LL0013, a syntax rule -- is INVISIBLE to it.
  // A gate written there would have reported SILENT, i.e. green, while the build was aborting. The
  // proof has to be the emitted JavaScript.
  // ===============================================================================================
  {
    // The declaration must produce NO DEFINITION. That is the whole point, and getting it wrong is
    // worse than having no `:extern` at all: codegen's visitFunction never looked at `extern`, so it
    // would emit `function btoa(s) {}` -- an empty stub that SHADOWS the real global and silently
    // turns every call into a no-op returning undefined.
    //
    // `btoa` is a REAL host global (node provides it) and is NOT in JS_GLOBALS, so this case is red
    // twice over today: the name does not resolve (LL0210), and LL0013 rejects the declaration that
    // would make it resolve.
    name: "Sd: an `:extern` fn is declared, not defined",
    source: `(fn :extern btoa [s <- String] -> String)
(console.log (btoa "hi"))`,
    expect: ["aGk="],
    emitted: {
      mustNot: [/function\s+btoa/, /\bbtoa\s*=\s*(function|\()/, /(const|let|var)\s+btoa\b/],
      must: [/btoa\(/], // ...but it IS still called
    },
    wasBroken:
      "`:extern` was unusable. LL0013 `ExternFunctionCannotHaveBody` tests `!!node.body`, and a " +
      "bodyless fn has `body: []` in BOTH frontends -- `!![]` is TRUE -- so EVERY correctly written " +
      "extern was rejected as having a body. Had it compiled, codegen would have emitted an empty " +
      "stub over the top of the real global",
  },
  {
    // An ambient VALUE -- `mouseX`, `frameCount`, `width`. Two rules stood in the way, not one:
    // LL0006 `ConstantVariableMustHaveInitializer` also fires, because an extern `let` has no value
    // BY DEFINITION. A declaration is a promise about the host, not a definition, so it has nothing
    // to initialise.
    //
    // `Infinity` is a real host global. A stub would emit `const Infinity = undefined`, which either
    // shadows it with `undefined` or is an outright redeclaration -- loud either way, which is the
    // point of asserting on the emitted text.
    name: "Sd: an `:extern` let is declared, not defined",
    source: `(let :extern Infinity <- Real)
(console.log Infinity)`,
    expect: ["Infinity"],
    emitted: { mustNot: [/(const|let|var)\s+Infinity\b/] },
    wasBroken:
      "`extern` existed only on FunctionNode. `:extern` was already LEGAL on a `let` (the modifier " +
      "whitelist admits it) and meant NOTHING -- a silent no-op. So an ambient VALUE could not be " +
      "declared at all, and LL0006 refused the bodyless form anyway",
  },
  {
    // ...and the rule must still do its actual job. A `:extern` WITH a body is a contradiction: a
    // declaration that also defines. Fixing LL0013's test must not amount to deleting the check.
    name: "Sd: an `:extern` fn WITH a body is still refused (guard)",
    source: `(fn :extern bad-fn [x <- Int] -> Int (return x))
(console.log 1)`,
    expectDiagnostic: /LL0013/,
    wasBroken:
      "not broken -- a guard. LL0013's test is fixed from `!!node.body` to `node.body.length > 0` " +
      "(exactly what its sibling LL0012 already does). A fix that made the rule stop firing " +
      "altogether would look identical on every other gate",
  },

  // ===============================================================================================
  // Fa -- CODEGEN STOPS GUESSING FROM SOURCE ORDER. D1's `(x)` is answered.
  //
  // The same expression compiled differently depending on where it sat in the file, because the
  // call/construct decision read `this.functions` / `this.classes` -- lists codegen fills AS IT
  // VISITS. That is the standing "codegen is source-order dependent" gap, and it made "a function may
  // be forward-referenced" a LIE, which is what blocked the forward-reference ruling (D24).
  // ===============================================================================================
  {
    // THE SILENT WRONG ANSWER. `(f)` before `(fn f ...)` printed the FUNCTION OBJECT.
    //
    // `fn` emits `function f(){}`, which JS hoists -- so the call was always safe at run time. The bug
    // was that codegen did not emit a CALL at all: `f` was not yet in `this.functions`, so `(f)`
    // compiled to a bare reference. Move the same line below the declaration and it compiled to
    // `f()`. One expression, two meanings, decided by position.
    name: "Fa: `(f)` before its declaration is a CALL",
    source: `(console.log (f))
(fn f [] -> Int (return 7))
(console.log (f))`,
    expect: ["7", "7"],
    wasBroken:
      "printed `[Function: f]` and then `7`. The SAME expression, compiled two ways, because " +
      "`this.functions` is a source-order list. It also made the forward-reference ruling unwritable: " +
      "you cannot say 'a function may be forward-referenced' while `(f)` silently is not a call",
  },
  {
    // ...and the class half of the same bug. A class used before its declaration emitted a reference
    // to the class OBJECT instead of constructing it -- `__ll_copy(Dog)` -- which the Known Gap
    // recorded as a silent wrong answer.
    // DEFERRED, deliberately -- and the first draft of this case taught the lesson.
    //
    // Written as `(let d (Dog "rex"))` ABOVE the `defclass`, it now emits `new Dog("rex")` correctly
    // and then dies: `ReferenceError: Cannot access 'Dog' before initialization`. That is the TDZ,
    // and it is exactly the program D24 refuses -- an IMMEDIATE forward reference to a value. Fa fixes
    // what codegen EMITS; it does not make an invalid program valid, and it should not.
    //
    // So the construction lives in a function body: deferred, legal, and it still proves the decision
    // is order-independent -- `Dog` is constructed from a body written ABOVE the class.
    name: "Fa: a class constructed before its declaration CONSTRUCTS",
    source: `(fn make [] (Dog "rex"))
(defclass Dog (let :ctor name))
(let d (make))
(console.log d.name)`,
    expect: ["rex"],
    emitted: { must: [/new Dog\(/], mustNot: [/__ll_copy\(Dog\)/] },
    wasBroken:
      "`this.classes` is a source-order list too, so `(Dog \"rex\")` written above the declaration was " +
      "not recognised as a construction. It emitted `__ll_copy(Dog)` -- the class OBJECT, cloned -- " +
      "and said nothing",
  },
  {
    // D1's ANSWER, and the case that decides it. `(x)` is NOT always a call.
    //
    // Measured: EVERY "grouping" use of `(x)` in the corpus is a variable inside a string
    // interpolation -- `'"Squares: {(squares)}"`. Every other zero-arg `(x)` is a genuine call. So
    // the rule is not "always call" (which breaks these) and not "always group" (which breaks
    // `(solve-maze)`). It is: A CALL IFF THE NAME IS A FUNCTION. The symbol table separates them,
    // wherever either is declared.
    name: "Fa/D1: `(x)` on a VARIABLE reads its value (the interpolation idiom)",
    source: `(let squares [1 4 9])
(fn total [] -> Int (return 14))
(console.log '"squares: {(squares)} total: {(total)}")`,
    // `[ 1, 4, 9 ]`, not `1,4,9`: an interpolated value goes through the runtime's
    // `__ll_format_object`, not JS's bare `${}` stringification. Not what this case is about, but it
    // is what the language actually prints, and a golden says what IS.
    expect: ["squares: [ 1, 4, 9 ] total: 14"],
    wasBroken:
      "not broken -- THE GUARD that makes D1's answer the right one. `(squares)` must read and " +
      "`(total)` must call, in the same expression. An 'always a call' rule was measured and it " +
      "breaks the suite: 10-algorithms and 00_bfs both interpolate `{(x)}` on a variable",
  },
  {
    // Mutual recursion: a function naming a function declared LATER. It works because `fn` is hoisted,
    // and it is why functions cannot simply be made declare-before-use.
    name: "Fa: mutual recursion still works (guard)",
    source: `(fn is-even [n <- Int] -> Boolean (if (== n 0) true (is-odd (- n 1))))
(fn is-odd [n <- Int] -> Boolean (if (== n 0) false (is-even (- n 1))))
(console.log (is-even 10) (is-odd 7))`,
    expect: ["true true"],
    wasBroken:
      "not broken -- a guard, and the reason D24 cannot ban forward references to functions. " +
      "`10-algorithms/04_recursion.lisp` relies on it",
  },

  // ===============================================================================================
  // D1, FULLY SETTLED. A lambda has a type, so a VARIABLE holding a function is callable.
  // ===============================================================================================
  {
    // The last corner. `(let f (fn [] 42))` then `(f)` printed the FUNCTION OBJECT, because a lambda
    // inferred `Unknown` -- `inferExpressionType` had no `case "function"` and fell through to its
    // `default`. A variable holding a function was indistinguishable from a variable holding anything
    // else, so codegen could not know `(f)` was a call.
    name: "D1: `(f)` on a variable holding a DIRECT lambda is a call",
    source: `(let f (fn [] 42))
(console.log (f))`,
    expect: ["42"],
    wasBroken: "printed `[Function]`. A lambda had no type at all, so codegen had nothing to ask",
  },
  {
    // ...and THROUGH a function that RETURNS a lambda. This is the case `test_stdlib` had to work
    // around with `(call c5)` for the whole life of the file.
    //
    // `(fn constantly [x] (fn [] x))` had an unannotated return, which was hardcoded to `Any` -- so
    // `(let c5 (constantly 5))` typed as `Any`. An unannotated return whose body hands back a lambda
    // is a FUNCTION type. Measured: 8 functions in the corpus are this shape (`constantly`, `partial`,
    // `compose`); 0 have a literal tail, so nothing else changes.
    name: "D1: `(c5)` through a function that RETURNS a lambda is a call",
    source: `(fn constantly [x] (fn [] x))
(let c5 (constantly 5))
(console.log (c5))`,
    expect: ["5"],
    wasBroken:
      "printed `() => { return __ll_copy(x); }`. `test_stdlib` shipped `(call c5)` to get round it, " +
      "and the note explaining why is now a note explaining why it no longer needs to",
  },
  {
    // THE GUARD THAT KEEPS D1 HONEST. A variable of any OTHER type still READS.
    //
    // This is the whole corpus idiom -- `'"Squares: {(squares)}"` -- and it is what makes "always a
    // call" the wrong rule. `(x)` is a call iff `x` is a function: DECLARED as one, or HOLDING one.
    name: "D1: `(x)` on a non-function variable still READS (guard)",
    source: `(let squares [1 4 9])
(let n 7)
(console.log '"squares: {(squares)} n: {(n)}")`,
    expect: ["squares: [ 1, 4, 9 ] n: 7"],
    wasBroken:
      "not broken -- the guard. If lambda inference ever typed a non-function as a function, or if " +
      "the rule slipped to 'always a call', this reads as a TypeError instead of a value",
  },
  // ===============================================================================================
  // D25 -- what a list IS. Phase X.
  //
  // Expression-ness is currently decided by `isExpressionContext()`, which asks "is there a `variable`
  // or `match` scope ANYWHERE above me on the stack" -- a POSITIONAL property answered by an
  // AMBIENT-STATE query. So the identical `if` node compiles two different ways depending on what
  // encloses it. Exactly the disease Phase F cured in the call decision (`this.functions`, a
  // source-order list).
  //
  // And call-vs-block is decided by `head._type === "simple-identifier"`, which is why an applied
  // lambda -- whose head is a LAMBDA -- can never be a call, and falls into the implicit-block path
  // that emits statements into an expression slot.
  //
  // These go RED before the fix. The three "unchanged" cases below are the ones that make the fix
  // falsifiable: they are what a careless fix breaks.
  // ===============================================================================================
  {
    name: "D25/Xb: an `if` in a call ARGUMENT is an expression",
    source: `(console.log (if true 1 2))`,
    expect: ["1"],
    emitted: { mustNot: [/console\.log\(\s*if\s*\(/] },
    wasBroken:
      "emitted `console.log(if (true) {` -- INVALID JAVASCRIPT (LL0101). The very same `if` node in " +
      "`(let x (if true 1 2))` compiles fine, because a `variable` scope is on the stack there and " +
      "isExpressionContext() therefore says yes. The node did not change; only its surroundings did.",
  },
  {
    name: "D25/Xb: an `if` as an OPERATOR OPERAND is an expression",
    source: `(console.log (+ 1 (if true 10 20)))`,
    expect: ["11"],
    wasBroken:
      "emitted `_2b(1, if (true) {` -- invalid JavaScript. Same root: an operand is an expression " +
      "slot, and nothing told codegen so.",
  },
  {
    name: "D25/Xb: a `when` in a call ARGUMENT is an expression",
    source: `(console.log (when true 42))`,
    expect: ["42"],
    wasBroken:
      "emitted `console.log(if (true) {` -- invalid JavaScript. `when` and `if` share the bug and " +
      "share the fix; both already have `asExpression`, which does the coercion correctly and is " +
      "simply never reached from an argument position.",
  },
  {
    name: "D25/Xc: an applied lambda literal is a CALL",
    source: `(console.log ((fn [x] (* x 2)) 21))`,
    expect: ["42"],
    wasBroken:
      "the head is a LAMBDA, not an identifier, so visitList fell through to the implicit-block path " +
      "and emitted the lambda and the argument as STATEMENTS into console.log's argument slot -- " +
      "`21;`, invalid JS. The roadmap blamed the grammar (\"the AST can represent it; the grammar " +
      "cannot parse it\"); measured, it parses fine. D25 rules a lambda-literal head a call, and it " +
      "is the one head that can be lifted: a block whose first form is a bare lambda literal is a NO-OP, " +
      "so the shape has no other meaning. A block whose first form is a CALL is every file in the repo.",
  },
  {
    name: "D25/Xc: `(call f a)` applies any callee -- the escape hatch",
    source: `(fn get-fn [] -> Any (return (fn [x] (* x 3))))
(console.log (call (get-fn) 5))`,
    expect: ["15"],
    wasBroken:
      "THE TENTH 'written and never wired in'. `CallNode` is in the AST and `visitCall` is in codegen " +
      "and is CORRECT -- and no source syntax has ever built one; the only producer is the desugarer, " +
      "for `|>`. So `(call g 2)` parsed as an ordinary list with head `call`, emitted a call to a " +
      "function named `call` that does not exist, and evaluated to NaN. SILENTLY. DECISIONS.md " +
      "described `(call c5)` as a working form while this was true.",
  },
  {
    name: "D25/Xc: a computed callee without `call` is DIAGNOSED, not silently blocked",
    // NO `-> Any` on get-fn, and that is the whole point: the return type must be INFERRED as a
    // function for the compiler to know this is a mistake. Declared `-> Any` it is Unknown, and
    // LL0220 deliberately says nothing -- see the companion case below.
    // NOT wrapped in our own `( ... )`: the harness adds the top-level list itself, and a second one
    // makes a block-inside-a-block -- which trips a PRE-EXISTING bug where the checker silently stops
    // checking a nested block's items once a declaration appears. Flagged in the roadmap; it would have
    // made this gate un-passable for a reason that has nothing to do with LL0220.
    source: `(fn get-fn [] (return (fn [x] (* x 3))))
(console.log ((get-fn) 5))`,
    expectDiagnostic: /LL0220/,
    wasBroken:
      "a list whose head is a non-lambda form is a BLOCK (that is the file wrapper, and it must stay " +
      "one), so `((get-fn) 5)` emitted statements into an expression slot -- invalid JS, reported as " +
      "LL0101 'this is a bug in the code generator'. It is not a codegen bug; it is a program the " +
      "language does not accept, and it should say so and name `call`.",
  },

  {
    name: "D25/Xc: LL0220 stays SILENT on an Unknown head (gradual typing)",
    source: `(fn get-fn [] -> Any (return (fn [x] (* x 3))))
(console.log ((get-fn) 5))`,
    // Compiles, and yields the BLOCK's value -- the last form. That is D25's reading, applied
    // honestly: the function on the left is computed and discarded.
    expect: ["5"],
    wasBroken:
      "NOT broken -- a GUARD, on the rule that governs this whole compiler: NEVER report an error " +
      "involving an Unknown type. `-> Any` makes the head Unknown, so LL0220 must not fire, even " +
      "though the shape is identical to the case above. The cost is honest and worth stating: this " +
      "mistake is only caught where the type is KNOWN, which today means where the return type was " +
      "INFERRED rather than declared `Any`. A checker that guesses here would report on correct code.",
  },

  {
    name: "D1/Xe: a FIELD is read, whatever it is called",
    // Deliberately shaped like examples/05-oop/00_inheritance.lisp -- the file that put `breed` in the
    // compiler's list in the first place. `nickname` is the same kind of field, declared the same way.
    source: `(defclass Dog
  (let :ctor breed)
  (let :ctor nickname)
  (fn show []
    (console.log (this.breed))
    (console.log (this.nickname))))
(let d (new Dog "corgi" "rex"))
(d.show)`,
    expect: ["corgi", "rex"],
    emitted: { mustNot: [/this\.nickname\(\)/] },
    wasBroken:
      "TWO FIELDS OF THE SAME CLASS, DECLARED IDENTICALLY. `(this.breed)` emitted `this.breed` and " +
      "`(this.nickname)` emitted `this.nickname()` -- a TypeError. The difference was that codegen " +
      "carried a hardcoded 30-name `knownPropertyNames` list, and `breed` was on it while `nickname` " +
      "was not. The list's own comments give it away -- `// Animal/entity properties: breed, species, " +
      "color, weight`, `// Balance and other state properties: balance, age, score` -- these are FIELD " +
      "NAMES LIFTED OUT OF THE EXAMPLE FILES and hardcoded into the compiler. Someone hit the bug in " +
      "the inheritance demo and added `breed`. " +
      "The compiler already knew: `typeInfo.members` holds the fields and `methodSignatures` the " +
      "methods. It only ever asked 'is it a METHOD', and when that said no it consulted the name list " +
      "instead of asking 'is it a FIELD'. Xe asks.",
  },

  {
    name: "D1/Xe: an UNTYPED receiver is dispatched at RUN TIME, not guessed",
    // `s` is a plain String and `e` an Error -- neither type is described to the symbol table, so
    // `memberKindOn` returns undefined for both. One member is a METHOD, the other a FIELD, and the
    // compiler cannot tell them apart. It no longer tries.
    source: `(let s "abc")
(console.log (s.toUpperCase))
(console.log (s.length))`,
    // One receiver, one METHOD and one PROPERTY. `s` is a plain JS string: the symbol table has never
    // been told what a String is, so `memberKindOn` returns undefined for BOTH, and the compiler cannot
    // tell them apart at all. The run time can, exactly.
    expect: ["ABC", "3"],
    emitted: { must: [/__ll_member/] },
    wasBroken:
      "Guessed from a 30-name list. `message` was on it, so `(e.message)` read; `toUpperCase` was not, " +
      "so `(s.toUpperCase)` called -- and both happened to be right, which is exactly why nobody looked. " +
      "MEASURED, the receivers that reach here are not only untyped JS: `v3.x`, `user.age` and " +
      "`final-account.balance` land here too -- ordinary USER fields whose type the checker cannot yet " +
      "infer. So the list would have had to contain `x`, `y`, `balance` and `age`, which is precisely " +
      "how the old one came to contain them. A name list can never be right. " +
      "`__ll_member` asks the RUN TIME, which knows exactly: a method is called, anything else is read. " +
      "The guess was never necessary -- it was only earlier. And it shrinks on its own: every receiver " +
      "the checker learns to type stops reaching the shim and goes back to a direct `.x` or `.m()`.",
  },

  // ===============================================================================================
  // Escapes. `"a\n b"` printed a BACKSLASH and an `n`.
  //
  // Both frontends already HAVE a correct decoder, and both bypass it on the plain-string path:
  //   - PEG's `Char` rule decodes (`"n" { return "\n"; }`) -- but `RawString` is written `$Char*`,
  //     and `$` takes the RAW MATCHED TEXT and throws the actions away.
  //   - grammar_v2's `formattedString()` calls `unescapeString()`; `string()` does `.slice(1,-1)`.
  // Which is why `'"a\n b"` (interpolated) decoded and `"a\n b"` (plain) did not. Same escape, two
  // answers, in one language.
  // ===============================================================================================
  {
    name: "escapes: \\n is a NEWLINE",
    source: `(console.log "a\\nb")`,
    expect: ["a", "b"],
    wasBroken:
      "printed `a\\nb` -- a literal backslash and an n. The emitted JS was `console.log(\"a\\\\nb\")`: " +
      "the backslash survived into the string value and was then RE-ESCAPED on the way out.",
  },
  {
    name: "escapes: \\t is a TAB",
    source: `(console.log "a\\tb")`,
    expect: ["a\tb"],
    wasBroken: "printed a literal backslash and a t.",
  },
  {
    name: "escapes: \\\" is a quote, \\\\ is one backslash",
    source: `(console.log "q\\"x")
(console.log "one\\\\two")`,
    expect: ['q"x', "one\\two"],
    wasBroken: "both survived as two characters, backslash included.",
  },
  {
    // Qg / AF-004. `￿` was decoded; `\xNN` was not -- the regex had a `u[0-9a-fA-F]{4}`
    // alternative and no `x` one, so `\x1b` matched the catch-all `.`, took the "an unknown escape is
    // the character itself" branch, and decoded to the three characters `x1b`. Silent: a length-12
    // ANSI string arrived as length 16 and simply did not colour anything.
    //
    // roadmap.md called string escapes FIXED, which was true of the shape it fixed (a correct decoder
    // being bypassed) and false of this one (the decoder itself lacking a case). Fixed and de-lied.
    name: "escapes: \\xNN is a hex escape (AF-004)",
    source: `(let e "\\x1b[31mR\\x1b[0m")
(console.log e.length)
(console.log (e.charCodeAt 0))
(console.log "\\x41\\x42")`,
    // ESC + "[31m"(4) + "R"(1) + ESC + "[0m"(3) = 10.
    expect: ["10", "27", "AB"],
    wasBroken:
      "`\\x1b` decoded to the literal characters `x1b`, so this string was length 14, not 10, and its " +
      "first character was `x` (120) rather than ESC (27). AF-004.",
  },
  {
    // The catch-all must still catch. `\x` not followed by two hex digits is not a hex escape, and
    // must fall back to the same "unknown escape is the character itself" rule as `\q` -- not throw,
    // and not silently eat the following characters.
    name: "escapes: a malformed \\x or \\u is still the character itself",
    source: `(console.log "a\\xZZb")
(console.log "a\\uZZZZb")
(console.log "a\\qb")`,
    expect: ["axZZb", "auZZZZb", "aqb"],
    wasBroken:
      "The `\\u` half WAS broken, and this guard is what found it. The decoder keyed on `esc[0]` " +
      "alone, but the catch-all `.` hands back a ONE-character esc -- so a malformed `\\uZZZZ` " +
      "arrived as plain `\"u\"`, took the unicode branch, and computed " +
      "`String.fromCharCode(parseInt(\"\", 16))` = fromCharCode(NaN) = a NUL byte. `\"a\\uZZZZb\"` " +
      "decoded to `a\\0ZZZZb`, silently. Adding `\\x` on the same `esc[0]` test would have " +
      "duplicated the bug instead of exposing it; keying on LENGTH (u+4, x+2) fixes both.",
  },
  {
    name: "escapes: \\\\n is a BACKSLASH then an n, not a newline",
    source: `(console.log "a\\\\nb")`,
    expect: ["a\\nb"],
    wasBroken:
      "THE CASE THAT BREAKS A NAIVE FIX, and the one the existing `unescapeString` gets wrong. It is a " +
      "chain of `.replace()` calls: `\\\\n` -> `\\\\` is not consumed first, so the `/\\\\n/` pass matches " +
      "the SECOND backslash and the n, and an escaped backslash followed by a letter n decodes to a " +
      "backslash and a NEWLINE. An escape decoder has to be a single pass over the string.",
  },
  {
    name: "escapes: an INTERPOLATED string decodes the same way",
    source: `(let n 5)
(console.log '"a\\nb {(n)}")`,
    expect: ["a", "b 5"],
    wasBroken:
      "NOT broken -- a GUARD. The interpolated path was the one that ALREADY worked, in both frontends, " +
      "which is exactly what made the plain-string bug visible as an inconsistency rather than a gap. " +
      "It must keep working, and it must agree with the plain path.",
  },

  // ===============================================================================================
  // D26 -- match guards. `pattern :when expr`.
  // ===============================================================================================
  {
    name: "D26: a guard picks the arm the pattern alone cannot",
    source: `(let n 5)
(console.log (match n {
  x :when (< x 0)   => "neg"
  x :when (< x 10)  => "small"
  _                 => "big"
}))`,
    expect: ["small"],
    wasBroken:
      "guards did not exist. `:when` was not a grammar rule, `MatchCaseNode` had no `guard` field, and " +
      "the corpus's own guards -- written `(< _ 0)` -- parsed as a THREE-ELEMENT list-pattern `[<, _, 0]`. " +
      "So every guarded arm fell through.",
  },
  {
    name: "D26: the guard reads the pattern's BINDING by name",
    source: `(let n 42)
(console.log (match n {
  x :when (> x 40)  => x
  _                 => 0
}))`,
    expect: ["42"],
    wasBroken:
      "the whole point of a clause over a `(< _ 0)` predicate: the pattern BINDS `x` and the guard READS " +
      "it. `x` must be in scope in the guard, and it must be the matched value.",
  },
  {
    name: "D26: a guard composes with a VECTOR destructure",
    source: `(console.log (match [3 1] {
  [a b] :when (> a b)  => "descending"
  [a b]                => "not"
  _                    => "other"
}))`,
    expect: ["descending"],
    wasBroken:
      "a guard is a separate clause, so it must ride on ANY pattern -- here a destructure -- and read the " +
      "names that pattern introduced (`a`, `b`).",
  },
  {
    name: "D26: a false guard FALLS THROUGH to the next arm",
    source: `(let n 5)
(console.log (match n {
  x :when (> x 100)  => "huge"
  x :when (> x 3)    => "medium"
  _                  => "small"
}))`,
    expect: ["medium"],
    wasBroken:
      "a guard that is false must not match -- the arm is skipped and the NEXT is tried, pattern included. " +
      "The first arm's pattern (`x`) matches everything; only its guard rejects.",
  },
  {
    name: "D26: an UNguarded arm still matches (guard is optional)",
    source: `(console.log (match 7 {
  1 => "one"
  7 => "seven"
  _ => "other"
}))`,
    expect: ["seven"],
    wasBroken:
      "NOT broken -- a GUARD (the other kind). `:when` is optional; adding the clause must not disturb a " +
      "case that has none. This is every match in the corpus.",
  },

  // ===============================================================================================
  // D27 -- `:of` type patterns. `x :of T` matches when the value is a T, and binds it.
  // Dead since forever: `generateCondition`'s `default:` returned `literal(false)`, so every type
  // pattern fell through. The runtime check it needed (`__ll_is_type`) existed and was live (the
  // operator registry calls it); RuntimeProvider even documents the intent -- "generateCondition
  // calling __ll_is_type". Never wired.
  // ===============================================================================================
  {
    name: "D27: `:of Int` matches an integer and binds it",
    source: `(console.log (match 5 {
  n :of Int => n
  _         => 0
}))`,
    expect: ["5"],
    wasBroken: "type-pattern hit `default: false`; the arm never matched. `n` also had to be bound and usable.",
  },
  {
    name: "D27: `:of` DISCRIMINATES -- the wrong type falls through",
    source: `(console.log (match 5 {
  s :of String => "string"
  n :of Int    => "int"
  _            => "other"
}))`,
    expect: ["int"],
    wasBroken:
      "if every `:of` returned false, this fell to `_`. If a fixed `:of` matched unconditionally, it " +
      "would wrongly say `string`. It must test the ACTUAL type.",
  },
  {
    name: "D27: `:of` matches a class instance by its type",
    source: `(defclass Dog (fn speak [] -> String (return "woof")))
(defclass Cat (fn speak [] -> String (return "meow")))
(let a (new Dog))
(console.log (match a {
  c :of Cat => "cat"
  d :of Dog => "dog"
  _         => "other"
}))`,
    expect: ["dog"],
    wasBroken:
      "the class case: `__ll_is_type` walks the prototype chain by `__ll_name`, so it must pick Dog over " +
      "Cat and over the `_` default.",
  },
  {
    name: "D27: `:of` composes with a `:when` guard",
    source: `(console.log (match 5 {
  n :of Int :when (> n 10) => "big int"
  n :of Int                => "int"
  _                        => "other"
}))`,
    expect: ["int"],
    wasBroken:
      "D26 + D27 together: the type pattern narrows and the guard tests. `(> n 10)` is false for 5, so " +
      "the first arm's GUARD rejects it and the second (unguarded `:of Int`) wins -- not the `_`.",
  },

  // ===============================================================================================
  // D28 -- rest patterns. `[a ...rest]` matches an array of length >= (fixed count) and binds the tail.
  // Dead: the rest element hit `generateCondition`'s `default: false`, and the array length check was
  // `=== elements.length` -- so a rest pattern demanded an EXACT length and then failed on the rest
  // element anyway. PEG had no RestPattern rule at all.
  // ===============================================================================================
  {
    name: "D28: `[a ...rest]` binds head and tail",
    // Asserts rest.length then rest[0] -- NOT `console.log rest`, which node prints as `[ 2, 3 ]`
    // (array formatting), a brittle thing to pin. Two plain numbers say the same and cannot be misread.
    source: `(match [1 2 3] {
  [a ...rest] => ((console.log rest.length) (console.log rest[0]))
  _           => (console.log "no")
})`,
    expect: ["2", "2"],
    wasBroken:
      "the length check was `=== 2` so `[1 2 3]` (length 3) never matched, and the rest element hit " +
      "`default: false` regardless. `rest` also had to be BOUND to the slice.",
  },
  {
    name: "D28: the head element still binds and is usable",
    source: `(console.log (match [10 20 30] {
  [a ...rest] => a
  _           => 0
}))`,
    expect: ["10"],
    wasBroken: "`a` is a normal element binding; the rest must not disturb it.",
  },
  {
    name: "D28: two fixed elements before the rest",
    source: `(match [1 2 3 4] {
  [a b ...rest] => ((console.log rest.length) (console.log rest[0]))
  _             => (console.log "no")
})`,
    expect: ["2", "3"],
    wasBroken: "length must be `>= 2` and the rest bind `slice(2)`.",
  },
  {
    name: "D28: a too-short array FALLS THROUGH",
    source: `(console.log (match [1] {
  [a b ...rest] => "matched"
  _             => "too short"
}))`,
    expect: ["too short"],
    wasBroken:
      "the length floor is a floor, not a formality: `[a b ...rest]` needs at least the two fixed " +
      "elements. A rest pattern that matched ANY array would say `matched` here.",
  },
  {
    name: "D28: an empty rest is an empty array, not a miss",
    source: `(match [1 2] {
  [a b ...rest] => (console.log rest.length)
  _             => (console.log "no")
})`,
    expect: ["0"],
    wasBroken:
      "`[1 2]` against `[a b ...rest]`: length is exactly 2, the fixed elements consume both, and `rest` " +
      "is `[]` (length 0). It must MATCH (length >= 2), not fall through.",
  },

  // ===============================================================================================
  // Inference: a self-referential return type. `(fn :operator + [o <- V] -> V ...)` returns the very
  // struct being defined -- and during collection that name does not resolve yet, so `convertAstType`
  // degraded `-> V` to Unknown. The operator's result therefore had no type, so `(let v3 (+ v1 v2))`
  // was Unknown and `v3.x` fell to the __ll_member run-time fallback (measured: 14 corpus sites).
  // ===============================================================================================
  {
    name: "infer: an operator that returns its own struct types the result",
    source: `(defstruct V
  (let :ctor x <- Int)
  (fn :operator + [o <- V] -> V (return (new V (+ this.x o.x)))))
(let v1 (new V 10))
(let v2 (new V 5))
(let v3 (+ v1 v2))
(console.log (v3.x))`,
    expect: ["15"],
    // The thermometer AS a gate: `v3` is typed as V, so `v3.x` is a KNOWN field and must NOT reach the
    // untyped-receiver run-time fallback.
    emitted: { mustNot: [/__ll_member\([^,]*,\s*"x"\)/] },
    wasBroken:
      "the `+` overload declares `-> V`, but V is the struct being defined, so during collection " +
      "`convertAstType` could not resolve it and returned Unknown. `findOperator` then handed back a " +
      "function whose `returns` was Unknown, `(+ v1 v2)` was Unknown, and `v3.x` compiled to " +
      "`__ll_member(v3, \"x\")` -- correct at run time, but only because the compiler had given up.",
  },
  {
    name: "infer: a method that returns its own type types the result",
    source: `(defstruct P
  (let :ctor x <- Int)
  (fn withX [nx <- Int] -> P (return (new P nx))))
(let a (new P 1))
(let b (a.withX 99))
(console.log (b.x))`,
    expect: ["99"],
    emitted: { mustNot: [/__ll_member\([^,]*,\s*"x"\)/] },
    wasBroken:
      "same root, via a method: `withX` declares `-> P` (self), so its stored return type was Unknown, " +
      "and `(a.withX 99)` had no type -- see the method-call-return companion gate. (Ib also required.)",
  },

  {
    name: "infer: a DASHED method on a typed receiver is a call, not a run-time member",
    source: `(defclass Circle
  (let :ctor r <- Int)
  (fn get-area [] -> Int (return (* this.r this.r))))
(let c (new Circle 5))
(console.log (c.get-area))`,
    expect: ["25"],
    emitted: { must: [/c\.get2darea\(\)/], mustNot: [/__ll_member\(c/] },
    wasBroken:
      "the method `get-area` is emitted as `get2darea()` (the `-` encodes to `2d`), but `memberKindOn` " +
      "was handed the ENCODED name `get2darea` while `methodSignatures` is keyed on the SOURCE name " +
      "`get-area`. So the lookup missed and every dashed method on a known receiver fell to the untyped " +
      "`__ll_member` fallback -- while its own definition emitted fine. The receiver name is encoded too " +
      "(`final-account` -> `final2daccount`), which broke `resolveSymbol` before the member lookup even " +
      "ran. Both now use the composite-identifier's SOURCE `id`.",
  },

  {
    name: "infer: an INHERITED field on `this` resolves through :extends",
    source: `(defclass Animal
  (let :ctor name)
  (fn speak [] -> Void (console.log "...")))
(defclass Dog :extends Animal
  (let :ctor breed)
  (fn describe [] -> Void (console.log (this.name) (this.breed))))
(let d (new Dog "Buddy" "Corgi"))
(d.describe)`,
    expect: ["Buddy Corgi"],
    emitted: { mustNot: [/__ll_member\(this/] },
    wasBroken:
      "a class's stored `members` are its OWN only, so `this.name` -- inherited from `Animal` via " +
      "`:extends` -- was not found on Dog and fell to the untyped `__ll_member` fallback, while Dog's " +
      "own `this.breed` resolved. `memberKindOn` now walks the `parentClass` chain until the member is " +
      "found or the chain ends.",
  },

  {
    name: "D30/Ita: std/iter is importable and a type conforms to Iterable<T>",
    source: `(import "std/iter")
(defstruct One :implements Iterable<Int>
  (let :ctor v <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (return this.v)))
(let o (new One 7))
(console.log (o.v))`,
    expect: ["7"],
    wasBroken:
      "NOT broken -- a GUARD, and the reason it exists is the 'who calls it?' rule. Ita ships the " +
      "iteration protocol as `lib/std/iter.lisp` (`Iterable<T>`, `Iterator<T>`), and NOTHING consumes " +
      "it until Itb/generators. A stdlib file with no test is exactly the kind of thing that rots " +
      "unnoticed. This pins that the interfaces parse, import, and are conformable-to -- so the " +
      "substrate Itb builds on cannot break silently. `Iterator<T>.next` returning `T?` (D30, folding " +
      "D9) is part of what compiles here.",
  },

  {
    name: "Itb: a field on a :each loop var over an array-of-structs resolves",
    source: `(defstruct P (let :ctor x <- Int) (let :ctor y <- Int))
(let pts [(new P 1 2) (new P 3 4)])
(for :each p :from pts :then (
  (console.log (p.x))
))`,
    expect: ["1", "3"],
    emitted: { mustNot: [/__ll_member\(p/] },
    wasBroken:
      "`p` had no type, so `(p.x)` fell to the untyped `__ll_member` run-time fallback. With `pts : P[]` " +
      "the loop var is `P` (Itb), so `p.x` is a known field and emits a direct read. The clean win the " +
      "element-typing gap was blocking (array-of-STRUCTS; array-of-maps still needs record types).",
  },

  // ===============================================================================================
  // D31/Ga -- generators. `:gen` + `yield` lower to a JS `function*`. A generator object is natively
  // iterable, so `for :each` over one works through the existing `for...of` -- no bridge yet.
  // ===============================================================================================
  {
    name: "D31: a :gen function is a function* and for :each drives it",
    source: `(import "std/iter")
(fn :gen count-up [n <- Int] -> Iterator<Int> (
  (mut i 0)
  (while (< i n) (
    (yield i)
    (i := (+ i 1))))))
(for :each x :from (count-up 3) :then (console.log x))`,
    expect: ["0", "1", "2"],
    emitted: { must: [/function\*/, /yield /] },
    wasBroken:
      "`:gen` was an unknown modifier (LL0015); codegen hardcoded `generator: false`; and `(yield i)` " +
      "-- `yield` is a SPECIAL_FORM with no codegen -- emitted `_yield(i)`, a call to a function that " +
      "does not exist. Now `:gen` sets the generator flag, the function emits `function*`, `(yield i)` " +
      "is a JS YieldExpression, and `for...of` over the resulting generator object just works.",
  },
  {
    name: "D31: a plain function is NOT a generator",
    source: `(fn plain [] -> Int (return 7))
(console.log (plain))`,
    expect: ["7"],
    emitted: { mustNot: [/function\*\s+plain/] },
    wasBroken:
      "GUARD. Only `:gen` makes a `function*`. A normal function must stay `function` -- the generator " +
      "flag is read from the modifier, not defaulted on.",
  },

  {
    name: "D30/Gc: a hand-written :implements Iterable struct drives for :each",
    source: `(import "std/iter")
(defstruct Countdown :implements Iterable<Int>
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(for :each x :from (new Countdown 3) :then (console.log x))`,
    expect: ["3", "2", "1"],
    emitted: { must: [/\[Symbol\.iterator\]\(\)/, /__ll_js_iter/] },
    wasBroken:
      "the struct had an `iterator()` method but no `[Symbol.iterator]`, and its `next()` returned `T?` " +
      "(nil = done), not `{value, done}`. So `for (x of new Countdown(3))` threw `... is not iterable`. " +
      "Gc injects a `[Symbol.iterator]` bridge on any `:implements Iterable` type, delegating through " +
      "`__ll_js_iter` which adapts `T?` to `{value, done}`. A generator needs none of this -- `function*` " +
      "is already a JS iterable -- so this is only for the hand-written iterable.",
  },

  {
    name: "D32/Aa: std/async is importable and Awaitable is implementable",
    source: `(import "std/async")
(defstruct Later :implements Awaitable<Int>
  (fn then [cb] -> Any (return nil)))
(console.log "ok")`,
    expect: ["ok"],
    wasBroken:
      "NOT broken -- a GUARD, the 'who calls it?' rule again. Aa ships `lib/std/async.lisp` " +
      "(`Awaitable<T>`, `Task<T>`), consumed by nothing until Ab wires the type rules. A stdlib file " +
      "with no test rots. This pins that the interfaces parse, import, and are conformable-to.",
  },

  // ===============================================================================================
  // Phase L / La -- the UNIFORM CURSOR. `(iter coll)` yields an `Iterator<T>` (next() -> T?, nil =
  // done) over ANY iterable -- array, generator, or `:implements Iterable` struct -- because after Gc
  // everything iterable carries `[Symbol.iterator]`. `(next it)` advances it. These are the substrate
  // the lazy LINQ operators (Lb/Lc) stand on; the early-exit ones (`take`) need this raw pull.
  // ===============================================================================================
  {
    name: "La: (iter)/(next) drive a cursor over an ARRAY, nil = done",
    source: `(let it (iter [1 2 3]))
(mut v (next it))
(while (!= v nil) (
  (console.log v)
  (v := (next it))))`,
    expect: ["1", "2", "3"],
    emitted: { must: [/const iter =/] },
    wasBroken:
      "RED first: `iter`/`next` were undefined (LL0210), because the uniform cursor did not exist. La " +
      "adds them as runtime builtins (the `head`/`elem` family in SYMBOL_MAP) -- `iter` needs " +
      "`[Symbol.iterator]`, which is inexpressible in l-lang source, exactly why `head`/`elem` cannot " +
      "leave the code generator either. `next` returning nil at exhaustion is what stops the loop.",
  },
  {
    name: "La: (iter) drives a cursor over a GENERATOR",
    source: `(import "std/iter")
(fn :gen count-up [n <- Int] -> Iterator<Int> (
  (mut i 0)
  (while (< i n) (
    (yield i)
    (i := (+ i 1))))))
(let it (iter (count-up 3)))
(mut v (next it))
(while (!= v nil) (
  (console.log v)
  (v := (next it))))`,
    expect: ["0", "1", "2"],
    wasBroken:
      "Same substrate, proven over a `:gen` generator object -- natively JS-iterable, so `iter` reaches " +
      "it through the same `[Symbol.iterator]` path as the array. One cursor primitive, every source.",
  },
  {
    name: "La: (iter) drives a cursor over a :implements Iterable STRUCT",
    source: `(import "std/iter")
(defstruct Countdown :implements Iterable<Int>
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(let it (iter (new Countdown 3)))
(mut v (next it))
(while (!= v nil) (
  (console.log v)
  (v := (next it))))`,
    expect: ["3", "2", "1"],
    wasBroken:
      "The third source kind: a hand-written iterable, reached through the `[Symbol.iterator]` bridge Gc " +
      "injected. `iter` adapts that bridge's `{value,done}` back to `T?` -- so array, generator and " +
      "struct all present the SAME `Iterator<T>` to the operators above. (Also pins `Iterator<T> " +
      ":implements Iterable<T>`: the struct's `iterator()` returns `this`, an Iterator used AS an Iterable.)",
  },

  // ===============================================================================================
  // Phase L / Lb -- the STRAIGHT-THROUGH lazy operators (`std/linq`). Each is a collection-FIRST
  // `:gen` over `for :each`, so the working infix `|>` threads the collection through: `(coll |> (map
  // f) |> (filter p))` is `filter(map(coll, f), p)`, a pipeline of generators. Consumed here by
  // `for :each` (Lc adds the terminal `to-list`). This is the roadmap's "C# LINQ steal", pure stdlib.
  // ===============================================================================================
  {
    name: "Lb: map |> filter, piped and consumed by for :each",
    source: `(import "std/linq")
(fn square [x <- Int] -> Int (* x x))
(fn is-even [x] (== (% x 2) 0))
(for :each v :from ([1 2 3 4 5] |> (map square) |> (filter is-even)) :then (console.log v))`,
    expect: ["4", "16"],
    emitted: { must: [/function\*/] },
    wasBroken:
      "RED first: `std/linq` did not exist, so `map`/`filter` were undefined. Lb ships them as " +
      "collection-first `:gen` functions. The pipe threads `[1..5]` first -> `map` squares (1 4 9 16 " +
      "25), `filter` keeps evens (4 16); both are lazy generators, driven by the outer `for :each`.",
  },
  {
    name: "Lb: enumerate yields [index value], destructured in the loop var",
    source: `(import "std/linq")
(for :each [i x] :from (["a" "b" "c"] |> enumerate) :then (console.log i x))`,
    expect: ["0 a", "1 b", "2 c"],
    wasBroken:
      "`enumerate` pairs each element with its index as a 2-element array (l-lang has no tuple type, " +
      "same as eager `seq.zip`). A bare `|> enumerate` stage threads the array as its sole argument.",
  },
  {
    name: "Lb: concat |> skip",
    source: `(import "std/linq")
(for :each v :from ([1 2] |> (concat [3 4 5]) |> (skip 1)) :then (console.log v))`,
    expect: ["2", "3", "4", "5"],
    wasBroken:
      "`concat` runs `a` then `b` (1 2 3 4 5); `skip 1` drops the first (2 3 4 5). Two `:gen`s composed " +
      "by the pipe -- `skip` uses a counter and `for :each`, no early exit needed.",
  },
  {
    name: "Lb: flat-map |> skip-while",
    source: `(import "std/linq")
(fn dup [x <- Int] -> Int[] [x x])
(for :each v :from ([1 2 3] |> (flat-map dup) |> (skip-while (fn [n] (< n 2)))) :then (console.log v))`,
    expect: ["2", "2", "3", "3"],
    wasBroken:
      "`flat-map dup` expands each x to `[x x]` and flattens (1 1 2 2 3 3) via a nested `for :each`; " +
      "`skip-while (< n 2)` drops the leading 1s and yields from the first failure on (2 2 3 3).",
  },

  // ===============================================================================================
  // Phase L / Lc -- EARLY-EXIT operators (`take`, `take-while`, `zip`) and TERMINALS (`to-list`,
  // `reduce`, `count`, `for-each`). The early-exit ones cannot use `for :each` (a `for...of` has no
  // `break`), so they pull La's raw cursor -- `(iter coll)` + `(next it)` -- under a `while` and stop
  // the instant they have enough. That is what makes them safe over an INFINITE source.
  // ===============================================================================================
  {
    name: "Lc: the LAZINESS PROOF -- take over an unbounded generator terminates",
    source: `(import "std/linq")
(fn :gen nats [] (
  (mut i 0)
  (while true (
    (yield i)
    (i := (+ i 1))))))
(fn square [x <- Int] -> Int (* x x))
(let result ((nats) |> (map square) |> (take 3) |> to-list))
(console.log result.length)
(console.log result[0] result[1] result[2])`,
    expect: ["3", "0 1 4"],
    wasBroken:
      "The star gate, falsifiable by construction: `nats` never stops, so this HANGS forever unless " +
      "`take` is genuinely lazy -- pulling exactly what it needs through the cursor and stopping. An " +
      "eager `take` (materialise then slice) would spin on `(while true)` and never return. It prints " +
      "`[0 1 4]` only because `map` and `take` do no work until `to-list` drives them element by element.",
  },
  {
    name: "TY3: `next` on a generator returns T?, and the nil-loop terminates",
    source: `(import "std/iter")
(fn :gen count-to [n <- Int] -> Iterator<Int> (
  (mut i 0)
  (while (< i n) ((yield i) (i := (+ i 1))))))
(let it (count-to 3))
(mut sum 0)
(mut v (next it))
(while (!= v nil) ((sum := (+ sum v)) (v := (next it))))
(console.log sum)`,
    expect: ["3"],
    wasBroken:
      "HUNG (or summed an object): a `:gen` is a JS `function*`, so `(next it)` forwarded the raw " +
      "`{value, done}` record -- never nil -- and the documented `(while (!= v nil) ...)` loop never " +
      "ended (D30 says `next` returns T?). Now unwrapped: 0+1+2 = 3.",
  },
  {
    name: "LB1: `take n` pulls EXACTLY n from its cursor, not n+1",
    source: `(import "std/linq")
(mut pulls 0)
(fn :gen counter [] -> Iterator<Int> (
  (mut i 0)
  (while true (
    (pulls := (+ pulls 1))
    (yield i)
    (i := (+ i 1))))))
(let taken ((counter) |> (take 3) |> to-list))
(console.log taken.length pulls)`,
    expect: ["3 3"],
    wasBroken:
      "`3 4`: take pulled `(next it)` at the END of each iteration and checked `i < n` at the START, " +
      "so it pulled the (n+1)th element before the loop stopped -- consumed but never yielded. Over a " +
      "shared/stateful cursor (tetris's 7-bag) that silently drops one element per call.",
  },
  {
    name: "Lc: take-while stops at the first failure, over an unbounded source",
    source: `(import "std/linq")
(fn :gen nats [] (
  (mut i 0)
  (while true (
    (yield i)
    (i := (+ i 1))))))
(fn square [x <- Int] -> Int (* x x))
(let result ((nats) |> (map square) |> (take-while (fn [n] (< n 20))) |> to-list))
(console.log result.length)
(console.log result[0] result[4])`,
    expect: ["5", "0 16"],
    wasBroken:
      "`take-while (< n 20)` over the infinite squares 0 1 4 9 16 25... yields the leading run below 20 " +
      "(0 1 4 9 16) and stops at 25 -- again, only terminating because the cursor is pulled lazily.",
  },
  {
    name: "Lc: zip advances two cursors in lockstep, stops at the shorter",
    source: `(import "std/linq")
(for :each [n s] :from ([1 2 3] |> (zip ["a" "b"])) :then (console.log n s))`,
    expect: ["1 a", "2 b"],
    wasBroken:
      "`zip` pulls a cursor from each side and yields `[x y]` until EITHER is exhausted -- so a 3-long " +
      "and a 2-long source produce two pairs. The `[n s]` destructuring loop var unpacks each pair.",
  },
  {
    name: "Lc: reduce folds, count sizes",
    source: `(import "std/linq")
(console.log ([1 2 3 4] |> (reduce (fn [a b] (+ a b)) 0)))
(console.log ([10 20 30] |> count))`,
    expect: ["10", "3"],
    wasBroken:
      "The terminals that COLLAPSE a sequence. `reduce` threads an accumulator (1+2+3+4 = 10); `count` " +
      "walks and tallies (3). Collection-first, so `|>` threads them like every other operator.",
  },
  {
    name: "Lc: for-each drives a sequence for its side effects",
    source: `(import "std/linq")
([1 2 3] |> (for-each (fn [x] (console.log (* x 10)))))`,
    expect: ["10", "20", "30"],
    wasBroken:
      "`for-each` is the eager terminal for effects -- it pulls every element and calls `f`, returning " +
      "nothing. Drives the whole (finite) sequence, unlike `take` which stops early.",
  },

  {
    name: "Mb: std/linq is a TWO-FILE package -- one import, union of both files' ops",
    source: `(import "std/linq")
(fn square [x <- Int] -> Int (* x x))
(console.log ([1 2 3 4 5] |> (map square) |> (take 3) |> count))`,
    expect: ["3"],
    wasBroken:
      "The Mb demonstrator on real code: `map` lives in `lib/std/linq/linq.lisp`, `take` and `count` " +
      "in `lib/std/linq/linq-early.lisp` -- two files, ONE package (`std/linq`). A single `(import " +
      "\"std/linq\")` yields the union of both files' exports (co-processing joins the sibling; neither " +
      "file imports the other). Before Mb an import resolved to a single file, so half these ops would " +
      "be undefined. Squares 1 4 9 16 25 -> take 3 -> count = 3.",
  },

  // ===============================================================================================
  // Phase E / Ea -- `:extension` methods, COMPILE-TIME nominal dispatch. `(x.m a)` lowers to the free
  // call `m(x, a)` when x's static type is a nominal user type lacking a native `m` and some
  // `:extension m` has a receiver type the checker deems a supertype (isSubtype). Native members win;
  // arrays/primitives never resolve (the checker does not model their methods).
  // ===============================================================================================
  {
    name: "Ea: (x.m) on a typed struct dispatches to a free :extension",
    source: `(defstruct Rectangle (let :ctor w <- Int) (let :ctor h <- Int))
(fn :extension area [self <- Rectangle] -> Int (* self.w self.h))
(let r (new Rectangle 3 4))
(console.log (r.area))`,
    expect: ["12"],
    emitted: { must: [/area\(r\)/], mustNot: [/r\.area\(/] },
    wasBroken:
      "`:extension` was unwired: `(r.area)` -- `area` being a known free function -- emitted `r.area()`, " +
      "`TypeError: r.area is not a function`. Ea resolves the extension in the checker (Rectangle has no " +
      "`area` member; `area`'s receiver is Rectangle) and codegen emits the free call `area(r)`.",
  },
  {
    name: "Ea: a PROTOCOL :extension dispatches on a nominal Iterable conformer",
    source: `(import "std/iter")
(defstruct Countdown :implements Iterable<Int>
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(fn :extension total [self <- Iterable<Int>] -> Int (
  (mut s 0)
  (for :each x :from self :then (s := (+ s x)))
  (return s)))
(let c (new Countdown 3))
(console.log (c.total))`,
    expect: ["6"],
    emitted: { must: [/total\(c\)/] },
    wasBroken:
      "The primary use case, and why runtime dispatch was a dead end: `total` targets `Iterable<Int>`, " +
      "and `Countdown :implements Iterable<Int>`. `isSubtype(Countdown, Iterable<Int>)` is nominal -- the " +
      "checker knows it -- so `(c.total)` lowers to `total(c)`, summing 3 2 1 = 6. `__ll_is_type` could " +
      "never have matched `Countdown` against `\"Iterable\"` at run time.",
  },
  {
    name: "Ea: a native array method is NOT shadowed by an Iterable :extension (guard)",
    source: `(import "std/iter")
(fn :extension map [self <- Iterable<Int> f] -> Int[] [999])
(let arr [1 2 3])
(let m (arr.map (fn [x] (* x 2))))
(console.log m[0] m[1] m[2])`,
    expect: ["2 4 6"],
    wasBroken:
      "The load-bearing guard. `arr : Int[]` conforms to `Iterable<Int>`, and the checker does not model " +
      "the native array `.map`, so a naive resolver would rewrite `(arr.map f)` to the bogus extension " +
      "`map` returning [999]. Resolution fires ONLY for nominal user types (struct/class/interface), " +
      "never arrays/primitives -- so `arr.map` stays the native eager map: 2 4 6, not 999.",
  },

  {
    name: "Eb: :extension :gen composes -- a lazy filter METHOD (D34)",
    source: `(import "std/iter")
(defstruct Countdown :implements Iterable<Int>
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(fn :extension :gen where [self <- Iterable<Int> pred] -> Iterator<Int>
  (for :each x :from self :then (
    (when (pred x) :then (yield x)))))
(let c (new Countdown 5))
(for :each x :from (c.where (fn [n] (> n 2))) :then (console.log x))`,
    expect: ["5", "4", "3"],
    emitted: { must: [/where\(c,/, /function\*/] },
    wasBroken:
      "D34's composition on real code: `:extension` is a DISPATCH modifier (call site), `:gen` a BODY " +
      "modifier (the emitted `function*`). They touch different phases, so they compose for free -- " +
      "`(c.where pred)` dispatches to the free `where(c, pred)`, which IS a generator: exactly C#'s " +
      "`IEnumerable.Where` with `yield`. Countdown 5 -> 5 4 3 2 1; where (> 2) -> 5 4 3, lazily.",
  },
  {
    name: "Nc: a computed-receiver :extension dispatches -- method chaining `((c.dbl).big)`",
    source: `(import "std/iter")
(defstruct Countdown :implements Iterable<Int>
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(fn :extension :gen dbl [self <- Iterable<Int>] -> Iterator<Int>
  (for :each x :from self :then ((yield (* x 2)))))
(fn :extension :gen big [self <- Iterable<Int>] -> Iterator<Int>
  (for :each x :from self :then ((when (> x 3) :then (yield x)))))
(let c (new Countdown 3))
(for :each x :from ((c.dbl).big) :then (console.log x))`,
    expect: ["6", "4"],
    emitted: { must: [/big\(\s*dbl\(/, /function\*/] },
    wasBroken:
      "Method chaining's backend half. `(c.dbl)` (first hop, NAMED receiver) dispatches via visitList to " +
      "`dbl(c)` : Iterator<Int>. The 2nd hop `((c.dbl).big)` is a computed CallNode(MemberNode) that flows " +
      "through visitCall -- which emitted the RAW `dbl(c).big(...)`, and a generator has no `.big`: a runtime " +
      "TypeError. Nc reads the intermediate's type from the node-type channel (Nb published `Iterator<Int>`) " +
      "and lowers to `big(dbl(c))`. Countdown 3 -> dbl 6 4 2 -> big (>3) 6 4, lazily.",
  },
  {
    name: "Nc: extension dispatch is transitive through interface chains (2 hops)",
    source: `(import "std/iter")
(definterface Countable :implements Iterable<Int>)
(definterface Numbered :implements Countable)
(defstruct Tally :implements Numbered
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (return nil)))
(fn :extension tag [self <- Iterable<Int>] -> String "tagged")
(fn probe [x <- Numbered] -> String (x.tag))
(console.log (probe (new Tally 3)))`,
    expect: ["tagged"],
    emitted: { must: [/tag\(x\)/] },
    wasBroken:
      "receiverConformsTo parity with the checker's isSubtype (Na). `Numbered :implements Countable " +
      ":implements Iterable`, and `tag` targets Iterable, so a Numbered-typed receiver must dispatch " +
      "`(x.tag)` -> `tag(x)` across TWO interface hops. The old walk checked only DIRECT " +
      "implementedInterfaces plus the parentClass chain, so it stopped at Countable; re-resolving each " +
      "interface by name reaches Iterable. (`tag` does not iterate self -- the struct [Symbol.iterator] " +
      "synthesis for a transitively-Iterable struct is a separate gap.)",
  },
  {
    name: "Nd: METHOD-CHAINING laziness proof -- `(((ns.map).filter).take).to-list` over infinite nats",
    source: `(import "std/linq")
(fn :gen nats [] -> Iterator<Int> (
  (mut i 0)
  (while true (
    (yield i)
    (i := (+ i 1))))))
(fn square [x <- Int] -> Int (* x x))
(let ns (nats))
(let result ((((ns.map square).filter (fn [x] (> x 4))).take 3).to-list))
(console.log result.length)
(console.log result[0] result[1] result[2])`,
    expect: ["3", "9 16 25"],
    // The chain lowers to NESTED free calls; the linq ops are imported, so each is inlined under a
    // unique `__ll_inlined_<name>_N` name (`to-list` encodes to `to2dlist`). The infinite-generator
    // `expect` is the real laziness proof -- it only terminates because `take` pulls the cursor lazily.
    emitted: { must: [/__ll_inlined_take_\d+\(\s*__ll_inlined_filter_\d+\(\s*__ll_inlined_map_\d+\(/, /function\*/] },
    wasBroken:
      "The headline: the LINQ operators, chained as METHODS, stay lazy over an INFINITE source. `(ns.map " +
      "square)` (named receiver) dispatches via visitList to `map(ns, square)`; each later hop " +
      "`.filter`/`.take`/`.to-list` is a computed CallNode that Nc dispatches by reading the intermediate's " +
      "`Iterator` type (Nb typed it, Na made the conformance real). `nats` never stops, so any eager hop " +
      "HANGS forever -- it returns [9 16 25] only because `take` pulls the cursor lazily. Same chain as the " +
      "pipe (D33's primary surface), method-style: squares 0 1 4 9 16 25..., >4 -> 9 16 25 36..., take 3.",
  },
  {
    name: "Nd: the `seq` gateway lifts an array into a lazy method chain",
    source: `(import "std/linq")
(let out (((seq [10 20 30]).map (fn [x] (+ x 1))).to-list))
(console.log out[0] out[1] out[2])`,
    expect: ["11 21 31"],
    emitted: { must: [/__ll_inlined_to2dlist_\d+\(\s*__ll_inlined_map_\d+\(\s*__ll_inlined_seq_\d+\(/] },
    wasBroken:
      "A bare array keeps native eager `.map` (the Ea guard), so `seq` is the array's opt-in to laziness: " +
      "`(seq arr)` is a `:gen` yielding a real generator, on which `.map`/`.to-list` dispatch as " +
      "extensions. `((seq [10 20 30]).map inc).to-list` -> to_list(map(seq([10,20,30]), inc)) = [11 21 31].",
  },

  // ===============================================================================================
  // Phase U -- TUPLE types `[Int String]` (fixed-length, heterogeneous, positional). A tuple is a JS
  // array at runtime, so codegen is unchanged; the work is grammar + type-system.
  // ===============================================================================================
  {
    name: "Ua: a tuple type `[Int Int]` parses and erases (both frontends)",
    source: `(fn f [p <- [Int Int]] -> Int (elem p 0))
(console.log (f [1 2]))`,
    expect: ["1"],
    wasBroken:
      "Neither frontend parsed `[Int Int]` as a type -- a hard parse error (grammar_v2) / a backtrack into " +
      "a phantom LL0210 (PEG). Ua adds a `tupleType` grammar rule (both frontends) + `TupleTypeNode`. The " +
      "type is ERASED at codegen -- a tuple IS a JS array -- so `(f [1 2])` runs and `(elem p 0)` is 1.",
  },

  {
    name: "Na: an :extension on a super-interface dispatches on a sub-interface receiver",
    source: `(import "std/iter")
(definterface Countable :implements Iterable<Int>)
(defstruct Countdown :implements Countable
  (mut :ctor n <- Int)
  (fn iterator [] -> Iterator<Int> (return this))
  (fn next [] -> Int? (
    (if (<= this.n 0)
        (return nil)
        (
          (let cur this.n)
          (this.n := (- this.n 1))
          (return cur))))))
(fn :extension label [self <- Iterable<Int>] -> String "iterable!")
(fn probe [x <- Countable] -> String (x.label))
(console.log (probe (new Countdown 3)))`,
    expect: ["iterable!"],
    emitted: { must: [/label\(x\)/] },
    wasBroken:
      "Na's codegen half, isolated to DISPATCH. `Countable :implements Iterable<Int>` and `label` targets " +
      "`Iterable<Int>`, so a `Countable`-typed receiver `x` must dispatch `(x.label)` -> `label(x)`. Before " +
      "Na, `visitInterface` dropped the `:implements` clause, so `Countable`'s type carried no " +
      "`implementedInterfaces` and `receiverConformsTo(Countable, \"Iterable\")` was false -- `(x.label)` " +
      "fell to `__ll_member` and read `undefined`. With the clause recorded, the one-hop conformance holds. " +
      "(`label` does not iterate `self`: codegen's `[Symbol.iterator]` synthesis for a TRANSITIVELY-Iterable " +
      "struct is a separate multi-hop gap, not LINQ-relevant -- generators are natively iterable.)",
  },

  // ===============================================================================================
  // Phase T / Jb -- codegen honours the native member table. A member access on a typed String/Array
  // receiver emits the DIRECT `.member()` / `.member`, not the untyped `__ll_member` fallback -- the
  // thermometer drops. (Ja taught the checker the types; this is the codegen half.)
  // ===============================================================================================
  {
    name: "Jb: a String method on a typed receiver emits a direct call, not __ll_member",
    source: `(let s "hello")
(console.log (s.toUpperCase))`,
    expect: ["HELLO"],
    emitted: { must: [/\.toUpperCase\(\)/], mustNot: [/__ll_member\(s/] },
    wasBroken:
      "After Ja the checker knows `s : String` and `s.toUpperCase : () -> String`, but codegen's " +
      "`memberKindIn` still returned undefined for a primitive receiver, so `(s.toUpperCase)` emitted " +
      "`__ll_member(s, \"toUpperCase\")`. Jb makes `memberKindIn` consult the same native table -> " +
      "`\"method\"` -> a direct `s.toUpperCase()`.",
  },
  {
    name: "Jb: a String field (length) emits a direct read, not __ll_member",
    source: `(let s "hello")
(console.log (s.length))`,
    expect: ["5"],
    emitted: { must: [/s\.length/], mustNot: [/__ll_member\(s/] },
    wasBroken:
      "`String.length` is a FIELD -> `memberKindIn` returns `\"field\"`, and a 0-arg field access emits " +
      "the bare `s.length` read rather than `__ll_member`.",
  },
  {
    name: "Jb: an Array field (length) emits a direct read",
    source: `(let arr [10 20 30])
(console.log (arr.length))`,
    expect: ["3"],
    emitted: { must: [/arr\.length/], mustNot: [/__ll_member\(arr/] },
    wasBroken:
      "Same for arrays: `arr : Int[]`, `arr.length : Int` (field) -> direct `arr.length`, not the " +
      "run-time fallback.",
  },

  // ===============================================================================================
  // Phase Xg -- the last D25 correctness gap: member access / method call on a COMPUTED (parenthesised)
  // expression. `((Vault).reveal)` emitted invalid JS (LL0101) because a `.member` suffix attaches only
  // to a NAME, so on a `(...)` group it falls out as a separate headless `composite-identifier` and the
  // 2-node list reads as a block. A desugar rewrite folds `[computed, .member, ...args]` into the
  // desugar-only `CallNode(MemberNode(...))`, which codegen already emits (the pipeline `|> .length`
  // proves the path). No codegen change.
  // ===============================================================================================
  {
    name: "Xg: a method call on a PARENTHESISED expression -- ((Vault).reveal)",
    source: `(defclass Vault
  (let :private secret 42)
  (fn reveal [] -> Int (return this.secret)))
(console.log ((Vault).reveal))`,
    expect: ["42"],
    wasBroken:
      "`((Vault).reveal)` was broken: the `.reveal` had no NAME to attach to (the object is a `(...)` " +
      "group), so it parsed as a separate headless `.reveal` and the 2-node list read as a block -> " +
      "`{ new Vault(); reveal; }` (bare `reveal` -> ReferenceError; in an expression slot, invalid JS / " +
      "LL0101). The workaround was `(let v (Vault))` first. Now `(expr).member` desugars to " +
      "`CallNode(MemberNode(expr, member))`. The computed object goes through the `__ll_member` runtime " +
      "fallback (a thermometer site -- codegen can't `memberKindOn` a computed receiver), which calls " +
      "`reveal()` -> 42. Correct output; the direct `.reveal()` would need typing the computed receiver.",
  },
  {
    name: "Xg: a method call with ARGS on a computed object -- ((Counter 10).plus 5)",
    source: `(defclass Counter
  (mut :ctor n <- Int)
  (fn plus [k <- Int] -> Int (return (+ this.n k))))
(console.log ((Counter 10).plus 5))`,
    expect: ["15"],
    wasBroken:
      "The arg-bearing form: `((Counter 10).plus 5)` -> `new Counter(10).plus(5)` = 15. `nodes.slice(2)` " +
      "are the arguments to the computed method; before Xg this too was LL0101.",
  },

  // --- The three that must NOT move. A careless fix breaks each of these. ---
  {
    name: "D25/Xb: a `return` inside a `cond` returns from the FUNCTION",
    source: `(
  (fn grade [score <- Int]
    (cond
      ((>= score 90) (return "A"))
      ((>= score 80) (return "B"))
      (true          (return "F"))))
  (console.log (grade 95))
  (console.log (grade 50))
)`,
    expect: ["A", "F"],
    // `must` an else-if CHAIN, and `mustNot` the switch's `case _else:`. NOT `mustNot: /switch/` --
    // the runtime shim has a legitimate `switch` in `__ll_is_type`, so that assertion matched the
    // SHIM and failed a program whose own emitted code was already correct. A gate that fires on
    // something other than the thing it names is worse than no gate.
    emitted: { must: [/else if/], mustNot: [/case\s+_else/] },
    wasBroken:
      "CAUGHT BY THE CORPUS, mid-Xb, exactly as the rule intends. `cond` used to emit a nested TERNARY " +
      "in expression position and `switch (true) { case <test>: ... }` in statement position. Ruling " +
      "`cond` an expression -- which it is, in every Lisp -- turned each case body into " +
      "`(() => { return \"A\"; })()`, which returns from the ARROW. `grade` then returned undefined and " +
      "13_flow_cond's golden printed `95 is: ` with nothing after it. THE GOLDEN WAS RIGHT AND THE " +
      "CHANGE WAS WRONG. " +
      "The form that serves both is an `if / else if / else` CHAIN: `return` keeps meaning `return`, " +
      "and asExpression walks the chain into a nested ternary when a value is actually wanted. It also " +
      "retires the switch, and with it `case _else:` -- `else` arrived as a bare identifier, so a " +
      "switch had to EVALUATE it as a case test, and `_else` is bound to nothing: valid JavaScript, " +
      "ReferenceError the moment no earlier case matched.",
  },
  {
    name: "D25: a simple `if` in VALUE position stays a TERNARY (no IIFE churn)",
    source: `(
  (let x (if true 1 2))
  (console.log x)
)`,
    expect: ["1"],
    emitted: { must: [/\?/], mustNot: [/\(\s*\(\s*\)\s*=>/] },
    wasBroken:
      "NOT broken -- a GUARD. `asExpression` wraps a statement in an IIFE, and if Xb routes every `if` " +
      "through it, every ternary in the corpus becomes `(() => { ... })()`. That churns the emitted JS " +
      "for ~100 cases and every golden -- and by the standing rule a moved golden is a FINDING, so a " +
      "careless fix would manufacture a hundred false ones. The ternary fast-path is the fix's real " +
      "constraint.",
  },
  {
    name: "D25: a list whose head is a CALL is still a BLOCK",
    source: `(
  (console.log 1)
  (console.log 2)
)`,
    expect: ["1", "2"],
    wasBroken:
      "NOT broken -- a GUARD, and the one that refutes the tempting general rule. This is the file " +
      "wrapper: a list whose head is itself a call. If a head that evaluates to a function were read " +
      "as the callee, EVERY file and EVERY function body in the repo would become 'apply the result of " +
      "the first form to the rest'. It is the most common shape in the language.",
  },
  {
    name: "D25: `((+ 1 2))` is still a GROUPING",
    source: `(console.log ((+ 1 2)))`,
    expect: ["3"],
    wasBroken:
      "NOT broken -- a GUARD. A single-element list whose element is not an identifier is redundant " +
      "parens. D1 leans on this: every `(x)` in a string interpolation in the corpus is this shape.",
  },

  // ===============================================================================================
  // Qa / AF-002 -- a SPREAD in a collection slot.
  //
  // `visitVector` maps `asValue` over every element (D11: a collection slot is a new home, so the
  // value is copied into it). `asValue` had no SpreadElement case, so it wrapped the SPREAD instead
  // of the spread's OPERAND:
  //
  //     (let b [0 ...a])   ->   const b = [0, __ll_copy(...a)];
  //
  // `__ll_copy` takes ONE parameter, so `__ll_copy(...a)` === `__ll_copy(a[0])` === a[0]. Every
  // element past the first is discarded by ordinary JS argument truncation, and the SpreadElement-ness
  // is destroyed in the same breath -- the element becomes a plain call. Exit 0, no diagnostic, both
  // (then-)frontends. `[x ...xs]` is the most idiomatic list operation in a Lisp and it silently
  // yielded a 2-element array.
  //
  // `asExpression` already had exactly this pass-through (see its SpreadElement case) -- the shape was
  // found once and fixed in one place only. No golden pinned the broken output because NOTHING in the
  // 91-example corpus spreads into a collection literal, which is why it survived.
  //
  // Fix: `asValue` copies the spread's OPERAND element-wise (`__ll_copy_each`) and re-wraps it as a
  // SpreadElement -- the identical reasoning `asValueEach` already documents for destructuring (the
  // container carries no struct marker; its ELEMENTS are what need copying).
  // ===============================================================================================
  {
    // Asserts length + elements rather than `console.log b` -- node's array formatting is brittle to
    // pin, as the D28 rest-pattern case above says in the same words.
    name: "Qa/AF-002: a spread in an array literal contributes ALL its elements",
    source: `(let a [1 2 3])
(let b [0 ...a])
(let c [...a])
(console.log b.length)
(console.log b[0] b[1] b[2] b[3])
(console.log c.length)
(console.log c[0] c[1] c[2])`,
    expect: ["4", "0 1 2 3", "3", "1 2 3"],
    // The exact broken shape. `__ll_copy(` applied to a spread is ALWAYS wrong -- the helper is
    // single-parameter, so the spread can only ever collapse to its first element.
    emitted: { mustNot: [/__ll_copy\(\.\.\./] },
    wasBroken:
      "`[0 ...a]` with a=[1 2 3] printed [0,1] and `[...a]` printed [1] -- silently, exit 0, no " +
      "diagnostic. Emitted `[0, __ll_copy(...a)]`; __ll_copy is single-parameter, so it collapsed " +
      "to a[0] and the spread became a plain call. AF-002, the post-audit's prize finding.",
  },
  {
    // The DISCRIMINATOR between the two candidate fixes, and the reason the operand is copied rather
    // than passed straight through.
    //
    // D11 says a collection slot is a NEW HOME, so `b`'s slot must hold a COPY -- mutating through
    // `b[0]` must not be visible via `a[0]`. Note this property held even while AF-002 was live, but
    // only BY ACCIDENT: `[__ll_copy(...a)]` copies a[0], so a ONE-element spread looked correct while
    // dropping nothing. That coincidence is exactly why a length assertion alone cannot protect this.
    //
    // A fix that merely emitted `[...a]` (no copy) passes the case above and FAILS this one: b[0]
    // would alias a[0] and print 99/99.
    name: "Qa/AF-002: a spread copies each element into its new slot (D11)",
    source: `(defstruct P (mut :ctor x <- Int 0))
(let a [(P 1) (P 2)])
(let b [...a])
(b[0].x := 99)
(console.log a[0].x)
(console.log b[0].x)
(console.log b.length)`,
    expect: ["1", "99", "2"],
    wasBroken:
      "NOT broken for the aliasing half -- a GUARD pinning WHY the operand is copied. The length " +
      "assertion is the AF-002 half: `[...a]` over two structs yielded ONE element.",
  },
  {
    // `visitMatrix` is the OTHER caller of the same `asValue` map. The audit flagged it as
    // "presumably broken the same way" and left it untested; it was, and fixing the shared helper
    // rather than the two call sites is what covers it. Pinned here so that stays true.
    // The row is bound before it is read, DELIBERATELY. `m[1].length` compiles to
    // `__ll_index(__ll_index(m, 1), "length")` -- a `.member` after an index becomes an INDEX whose
    // key is the member name, and D9 makes an absent key throw, so it dies with
    // `IndexOutOfRange: length`. That is a separate live bug (found while writing this case, filed
    // in the Qa commit); binding the row first routes around it so this case tests AF-002 and only
    // AF-002.
    name: "Qa/AF-002: a spread in a matrix row contributes all its elements",
    source: `(let r [1 2 3])
(let m [0,0 | ...r])
(let row m[1])
(console.log row.length)
(console.log row[0] row[1] row[2])`,
    expect: ["3", "1 2 3"],
    emitted: { mustNot: [/__ll_copy\(\.\.\./] },
    wasBroken:
      "`visitMatrix` maps the identical `asValue` over each row's elements, so a spread in a row " +
      "collapsed to its first element exactly as in a vector. Untested by the audit; confirmed here.",
  },

  // ===============================================================================================
  // Qb / AF-043 -- `try` in EXPRESSION position evaluated to `undefined`.
  //
  // `visitTryCatch` emits a TryStatement. In a value slot `asExpression` wraps it in an IIFE and
  // calls `withTrailingReturn` to give the block its value -- and that helper's fallthrough said, in
  // its own words:
  //
  //     // A `return`, an `if`, a loop -- nothing to convert. Leave it; the block's value is undefined.
  //
  // So the IIFE returned nothing:
  //
  //     const w = __ll_copy((() => { try { { throw(...); 1; } } catch (t) { ... 99 } })());
  //
  // -- no `return` anywhere, `w === undefined`. Silent, and it defeats a declared return type: a fn
  // annotated `-> Int` happily returned undefined.
  //
  // The catch handler is an if/else CHAIN (`if (t instanceof E) { const e = t; ... } else <next>`,
  // built by visitTryCatch for the `:of` filter), so converting the TryStatement alone is not enough
  // -- the IfStatement arms carry the value. Both cases are needed, and the `if` half is required BY
  // AF-043, not adjacent to it.
  //
  // The FINALIZER is deliberately NOT converted: in JavaScript a `return` inside `finally` OVERRIDES
  // the try/catch's value, so giving it one would silently rewrite the answer. Pinned below.
  // ===============================================================================================
  {
    name: "Qb/AF-043: `try` in expression position yields the try block's value",
    source: `(let v (try (42) catch e :of Error (0)))
(console.log v)`,
    expect: ["42"],
    wasBroken: "`undefined` -- the IIFE wrapped the TryStatement and returned nothing. AF-043.",
  },
  {
    name: "Qb/AF-043: a caught `try` expression yields the HANDLER's value",
    source: `(let w (try ((throw (Error "boom")) 1) catch e :of Error (99)))
(console.log w)`,
    expect: ["99"],
    wasBroken:
      "`undefined`. The handler is an if/else chain for the `:of` filter, and withTrailingReturn " +
      "declined to convert an `if` -- so even a matched catch arm's value was dropped.",
  },
  {
    name: "Qb/AF-043: a `try` expression satisfies its declared return type",
    source: `(fn pick [] -> Int (
  (return (try (7) catch e :of Error (0)))
))
(console.log (pick))`,
    expect: ["7"],
    wasBroken:
      "`undefined` from a fn the checker had certified `-> Int`. The type was right and the emitter " +
      "did not honour it -- the exact shape a gradual checker cannot catch on its own.",
  },
  {
    // A GUARD, not a bug: `finally` must not become the answer.
    //
    // JS gives a `return` in `finally` priority over the try/catch's return, so converting the
    // finalizer's tail would make `z` 3 instead of 1 -- silently, and only for programs that use
    // finally. The fix converts `block` and `handler` and pointedly leaves `finalizer` alone.
    name: "Qb/AF-043: `finally` runs but does NOT supply the value",
    source: `(let z (try (1) catch e :of Error (2) finally ((console.log "cleanup") 3)))
(console.log z)`,
    expect: ["cleanup", "1"],
    wasBroken:
      "NOT broken -- a GUARD on the fix. `finally` is the one block whose trailing expression must " +
      "stay unconverted, because JS lets a `return` there override the real answer.",
  },

  // ===============================================================================================
  // Qc / AF-003 (the short-circuit half) -- `||` and `&&` evaluated BOTH operands.
  //
  // Every operator routes through a runtime shim so an `:operator` overload can be found:
  //
  //     const _7c7c = (...args) => args.reduce((a, b) => a || b);
  //     (|| a b)  ->  _7c7c(a, b)
  //
  // The VALUES are right -- it folds with JS's own `||`. But a shim is a CALL, and a call evaluates
  // its arguments before it runs. So `||` and `&&` were not short-circuiting, which is not an
  // optimisation detail: it is their semantics. `(|| true (expensive))` ran `expensive`, and every
  // `(|| (== x nil) (x.method))` nil-guard dereferenced the very nil it was guarding against.
  //
  // These two cannot be overloaded for exactly the reason they must short-circuit: an overload is a
  // function, and a function cannot decline to evaluate its argument. Nothing in lib/ or examples/
  // overloads them. So they are emitted as native LogicalExpressions.
  //
  // Value-identical by construction: the shim folds LEFT with `||`/`&&`, and `a || b || c` is the
  // same fold. Only the evaluation ORDER changes -- which is the entire fix.
  //
  // NOT fixed here: AF-003's other half, a `(return x)` used AS an operand. That one is a RULING
  // (the repo already has one for `cond` -- see "D25/Xb: a `return` inside a `cond` returns from the
  // FUNCTION" under "The three that must NOT move" -- and ||/&& disagree with it). Filed, not guessed.
  // ===============================================================================================
  {
    name: "Qc/AF-003: `||` short-circuits -- a true left operand skips the right",
    source: `(fn loud [] -> Boolean (
  (console.log "EVALUATED")
  (return true)
))
(let a (|| true (loud)))
(console.log a)`,
    expect: ["true"],
    emitted: { mustNot: [/_7c7c\(/] },
    wasBroken:
      "printed EVALUATED first -- `_7c7c(true, loud())` is a CALL, so `loud()` ran before the " +
      "operator could decide `true` already won.",
  },
  {
    name: "Qc/AF-003: `&&` short-circuits -- a false left operand skips the right",
    source: `(fn loud [] -> Boolean (
  (console.log "EVALUATED")
  (return true)
))
(let b (&& false (loud)))
(console.log b)`,
    expect: ["false"],
    emitted: { mustNot: [/_2626\(/] },
    wasBroken: "printed EVALUATED -- same shim-is-a-call defect as `||`.",
  },
  {
    // The strongest form of the claim: the right operand is not merely unobserved, it does not RUN.
    // A `loud` that prints proves order; a `boom` that throws proves execution.
    //
    // This replaced a nil-guard case -- `(|| (== s nil) (== s.length 0))` -- which turned out not to
    // compile at all: the checker refuses `s.length` on a `String?` with LL0205 regardless of the
    // guard. So the finding's "every `(|| (== x nil) (x.method))` nil-guard in the corpus has the
    // same problem" OVERSTATES it: with a typed receiver that guard is unwritable. The exposure is
    // real only where the receiver is untyped and LL0205 never fires. Measured, not inherited.
    name: "Qc/AF-003: a short-circuited operand does not RUN, not merely go unread",
    source: `(fn boom [] -> Boolean (
  (throw (Error "the right operand must not run"))
  (return true)
))
(console.log (|| true (boom)))
(console.log (&& false (boom)))`,
    expect: ["true", "false"],
    wasBroken:
      "both THREW. `_7c7c(true, boom())` is a call, so `boom()` ran to completion -- or in this case " +
      "failed to -- before `||` ever saw an operand.",
  },
  {
    // Values must not drift while evaluation order is fixed.
    //
    // Note the operands are Booleans, and that is not incidental: `||`/`&&` are BOOLEAN-typed here.
    // `(|| false 5)` is LL0204 ("Operator '||' is not defined for Boolean and Int"), so JS's
    // yield-the-operand semantics is not reachable in well-typed code at all. That makes the switch
    // to a native LogicalExpression strictly safer than the shim it replaces -- there is no operand
    // -vs- boolean discrepancy for it to expose.
    name: "Qc/AF-003: `||`/`&&` values survive, and still fold n-ary",
    source: `(console.log (|| false true))
(console.log (&& true false))
(console.log (|| false false true))
(console.log (&& true true false))`,
    expect: ["true", "false", "true", "false"],
    wasBroken:
      "NOT broken -- a GUARD. The shim folded LEFT with JS's own `||`/`&&`, and native `a || b || c` " +
      "is the identical fold, so every value here must survive the switch untouched.",
  },

  // ===============================================================================================
  // Qd / D39 -- `and` / `or` / `not` are aliases for `&&` / `||` / `!`.
  //
  // They did not exist: `(and a b)` was `LL0210 'and' is not defined`. In a Lisp-syntax language
  // that is a conspicuous omission, and plenty of modern languages carry both spellings. Ruled in
  // as part of D39.
  //
  // Rewritten in the DESUGARER -- after symbols, before types -- so both halves of the compiler read
  // one program. The checker has no rule for a function named `and`; it types `(&& a b)`. Codegen's
  // short-circuit path keys on `&&`/`||` too. Aliasing in either place alone would require the rule
  // to be stated twice, which is exactly how this compiler has previously ended up with two answers.
  //
  // Head position only: `(and a b)` is the operator, while a value named `and` is untouched.
  // ===============================================================================================
  {
    name: "Qd: `and` / `or` / `not` are the operators they alias",
    source: `(console.log (and true false))
(console.log (or false true))
(console.log (not true))
(console.log (and true true false))
(console.log (or false false true))`,
    expect: ["false", "true", "false", "false", "true"],
    wasBroken: "`ELL0210 'and' is not defined` -- a Lisp with no `and`. D39 ruled them in.",
  },
  {
    // The alias must inherit the SEMANTICS, not just the name -- otherwise `or` would be a
    // second-class `||` that evaluates both sides, which is the bug Qc just removed.
    name: "Qd: an aliased `or`/`and` short-circuits exactly like `||`/`&&`",
    source: `(fn boom [] -> Boolean (
  (throw (Error "the right operand must not run"))
  (return true)
))
(console.log (or true (boom)))
(console.log (and false (boom)))`,
    expect: ["true", "false"],
    wasBroken:
      "n/a -- `or` did not exist. A GUARD that the alias desugars to the real operator rather than " +
      "to a call, so it cannot drift back into evaluating both operands.",
  },

  // ===============================================================================================
  // Qe / AF-020 -- a MID-LIST rest `[a ...mid z]` was accepted and silently misbound.
  //
  // D28: "Rest is trailing only -- a rest in the middle (`[a ...mid z]`) is a separate, harder
  // feature." roadmap: "a mid-list rest and anonymous `[a ...]` are unbuilt." ast.ts, on
  // RestPatternNode itself: "only meaningful as the final element of a vector pattern."
  //
  // Documented three times, enforced nowhere. It parsed, compiled, and FIRED, emitting three
  // distinct defects in one line -- against `[1 2 3]`, binding a=1, mid=[], z=3:
  //
  //     if (Array.isArray(t) && t.length === 3
  //         && (a = t[0], true) && (mid = t.slice(3), true) && (z = t[2], true))
  //
  //   (1) `t.length === 3` counts the rest as ONE fixed slot and checks EXACTLY, so a mid-rest can
  //       never match a longer array -- `[1 2 3 4]` silently fell through to `_`.
  //   (2) `mid = t.slice(3)` slices from the element COUNT rather than the leading fixed count, so
  //       mid was ALWAYS [].
  //   (3) `z = t[2]` indexes from the LEFT, right only by accident when length == element count.
  //
  // So the one length that matched was the one length that hid defects (2) and (3).
  //
  // WHY REJECT RATHER THAN IMPLEMENT. The ruling already exists and says not-supported, and its
  // sibling proves what that means: anonymous `[a ...]`, named in the very same D28 sentence, IS
  // rejected. "Unbuilt" here means not-accepted. Implementing mid-rest would OVERRIDE a decision
  // D28 made deliberately ("a separate, harder feature"), which is a feature phase, not a bug fix.
  // The bug is that the compiler accepted what its own ruling forbids and then lied about the
  // answer. Enforcing the ruling IS the fix.
  //
  // The rule is DECLARATIVE (NodeValidationRules), because "a rest must be last" is a pure
  // structural predicate on the node -- exactly what D38 says belongs there rather than at a call
  // site. Nothing in lib/ or examples/ uses a mid-list rest.
  // ===============================================================================================
  {
    name: "Qe/AF-020: a mid-list rest is REJECTED, not silently misbound",
    source: `(match [1 2 3] {
  [a ...mid z] => (console.log "fired" a mid.length z)
  _            => (console.log "fell-through")
})`,
    expectDiagnostic: /LL0029/,
    wasBroken:
      "printed `fired 1 0 3` -- exit 0, zero diagnostics. The arm FIRED and bound mid=[] when the " +
      "only correct binding is mid=[2]. D28 says a mid-list rest is unbuilt; it was built, reachable " +
      "and wrong. AF-020.",
  },
  {
    // The GUARD that the rejection is narrow. A TRAILING rest is D28's supported case and must keep
    // working exactly as it did -- the new rule keys on POSITION, not on the presence of a rest.
    name: "Qe/AF-020: a trailing rest still binds (D28's supported case)",
    source: `(match [1 2 3] {
  [a ...rest] => (console.log a rest.length rest[0])
  _           => (console.log "no")
})`,
    expect: ["1 2 2"],
    wasBroken:
      "NOT broken -- a GUARD. D28's trailing rest is the case that WORKS, and the mid-rest rejection " +
      "must not touch it.",
  },

  // ===============================================================================================
  // Qf / AF-019 -- a custom modifier on a `defclass` was silently dropped.
  //
  // D3b: a `defmodifier` body is a RUNTIME DECORATOR, applied at the use site. On a fn it is:
  //
  //     const add = __ll_modifier_traced()(function (a, b) { ... });
  //
  // On a class it was nothing at all -- `class Base { ... }`, undecorated. The SAME modifier, on two
  // declarations, one honoured and one dropped, exit 0, no diagnostic.
  //
  // What makes this worse than an omission: LL0015's own remedy text sends users here. Put an unknown
  // modifier on a class and the compiler says "Unknown modifier ':abstract' on class. Declare it with
  // (defmodifier abstract ...) if it is meant to be a custom modifier." Do exactly that, and the
  // modifier is silently discarded. The diagnostic promised a feature the emitter did not have.
  //
  // So this is IMPLEMENTED, where Qe's mid-list rest was rejected -- and the difference is the
  // ruling, not the effort. D28 says a mid-rest is "a separate, harder feature"; nothing says a class
  // modifier is unsupported, and LL0015 affirmatively says it works. Enforce the ruling that exists.
  // ===============================================================================================
  {
    name: "Qf/AF-019: a custom modifier on a defclass is APPLIED",
    source: `(defmodifier traced []
  (fn [original]
    (console.log "[traced] APPLIED")
    original))
(defclass :traced Base
  (fn speak [] -> String (return "base")))
(let b (Base))
(console.log (b.speak))`,
    expect: ["[traced] APPLIED", "base"],
    wasBroken:
      "printed only `base` -- the decorator was emitted and never invoked for the class. The `fn` " +
      "half of the same modifier worked, which is what proves the drop. AF-019.",
  },
  {
    // The GUARD: an unmodified class must stay a bare ClassDeclaration. The wrap is what turns a
    // class declaration into a `const X = ...(class X{})`, and paying that for every class in the
    // corpus would be both noise and a hoisting change.
    name: "Qf/AF-019: a class with no custom modifier is not wrapped",
    source: `(defclass Plain
  (fn speak [] -> String (return "plain")))
(let p (Plain))
(console.log (p.speak))`,
    expect: ["plain"],
    emitted: { mustNot: [/__ll_modifier_/], must: [/class Plain/] },
    wasBroken:
      "NOT broken -- a GUARD. Only a CUSTOM (defmodifier-declared) modifier may wrap; a builtin is a " +
      "fact for the compiler, and no modifier at all must leave the declaration exactly as it was.",
  },

  // ===============================================================================================
  // Va / AF-044 -- a map key that collides with a modifier keyword was a hard PARSE ERROR.
  //
  //     (let m {:step 1})   ->   Expecting token of type --> RBrace <-- but found --> ':step' <--
  //
  // A modifier keyword lexes as ONE token INCLUDING its colon (`:step` -> StepModKw, pattern
  // `/:step(?![a-zA-Z0-9_-])/`). The map's `keyValue` rule wanted a separate `Colon` followed by an
  // Identifier -- which is why `{:name "x"}` parses (Colon + Identifier) and `{:step 1}` cannot.
  // Chevrotain lexes context-free, so the lexer cannot know it is inside a map; the parser has to
  // accept the token.
  //
  // D13 rules map keys are STRINGS, never mangled -- `{:my-key 1}` emits `{"my-key": 1}` verbatim.
  // A key is data. `{:step 1}` is a step count, not a for-loop clause, and nothing about the grammar
  // of `for` should reach into an object literal.
  //
  // ESCALATED BY Pb. The PEG accepted these and emitted correct JS, so it was the workaround; with
  // the PEG retired there is no way to write the key at all. That is why this leads Phase V.
  //
  // THE AUDIT'S LIST IS WRONG, and the real rule is cleaner. AF-044 says
  // ":step :each :from :then :of :when :as :while :mut :let". Measured: `:while`, `:mut` and `:let`
  // parse FINE (they are `mut`/`let`/`while` keywords with no colon in the token, so they arrive as
  // Colon + Kw). And it MISSES seven: `:cond :else :init :is :where :extends :implements`. The set is
  // exactly the 14 MODIFIER keywords -- no more, no less.
  // ===============================================================================================
  {
    // All 14, so the rule is pinned as "every modifier keyword", not "the ones someone happened to
    // list". A future modifier keyword joining the category is covered by construction.
    //
    // Read back through JSON rather than dot-access, because THREE of the fourteen -- `else`,
    // `extends`, `implements` -- are JS RESERVED WORDS, and `encodeIdentifier` prefixes those with an
    // underscore on the read side (`m.else` emits `m._else`) while the key itself stays `"else"`
    // verbatim per D13. So the key round-trips through `m["else"]` and not through `m.else`.
    //
    // That is NOT this fix's bug and is deliberately not fixed here: it is D13's own accepted cost --
    // "dot-access (`m.my-key`) can't reach these keys -- use `m[\"my-key\"]` instead" -- and the same
    // shape the audit already filed as AF-005 (a hyphenated dot-access silently reads undefined).
    // Va's business is that the key PARSES at all.
    name: "Va/AF-044: every modifier keyword is usable as a map key",
    source: `(let m {:step 1 :each 2 :from 3 :then 4 :of 5 :when 6 :as 7
        :cond 8 :else 9 :init 10 :is 11 :where 12 :extends 13 :implements 14})
(console.log (JSON.stringify m))
(console.log m.step m.each m.from m.then m.of m.when m.as)
(console.log m.cond m.init m.is m.where)
(console.log m["else"] m["extends"] m["implements"])`,
    expect: [
      `{"step":1,"each":2,"from":3,"then":4,"of":5,"when":6,"as":7,"cond":8,"else":9,"init":10,"is":11,"where":12,"extends":13,"implements":14}`,
      "1 2 3 4 5 6 7",
      "8 10 11 12",
      "9 13 14",
    ],
    wasBroken:
      "`Expecting token of type --> RBrace <-- but found --> ':step' <--`. A hard parse error on a " +
      "map key. The PEG accepted it and emitted correct JS, so retiring the PEG (Pb) removed the " +
      "only way to write it. AF-044.",
  },
  {
    // The GUARD the audit's own (wrong) list points at: these were never broken and must not become
    // so. They are Colon + keyword, not a single colon-bearing token.
    name: "Va/AF-044: `:while` / `:mut` / `:let` keys keep working",
    source: `(let m {:while 1 :mut 2 :let 3 :name "n"})
(console.log m.while m.mut m.let m.name)`,
    expect: ["1 2 3 n"],
    wasBroken:
      "NOT broken -- a GUARD, and a correction. AF-044 lists all three as rejected; measurement says " +
      "they parse fine, because `mut`/`let`/`while` are keywords WITHOUT a colon in the token.",
  },
  {
    // D13's own example, and the reason a key is data rather than syntax: the key must survive to
    // the emitted object VERBATIM, whatever it collides with.
    name: "Va/AF-044: a modifier-keyword key is a plain string in the emitted object",
    source: `(let m {:from "src" :to "dst"})
(console.log (JSON.stringify m))`,
    expect: [`{"from":"src","to":"dst"}`],
    wasBroken:
      "unparseable. D13 rules a key is a STRING, never mangled -- so `:from` must reach JSON as " +
      "`from`, not as a for-clause and not as an encoded name.",
  },

  // ===============================================================================================
  // Vb / AF-006 -- `typeof` and friends emitted calls to functions that cannot exist.
  //
  //     (typeof x)        ->   console.log(_typeof(x));       ReferenceError
  //     (instanceof d D)  ->   console.log(_instanceof(d, D));  ReferenceError
  //
  // Compiles clean, exit 0, dies on the first line that runs.
  //
  // `SPECIAL_FORMS` (analysis/listForm.ts) already lists all four of typeof / instanceof / in /
  // delete -- the TYPE CHECKER knows they are not calls, because routing them through call inference
  // would type `(typeof x)` as a call to an unknown function named `typeof`. Codegen never got the
  // same list: visitList special-cases `return`, `yield` and `new`, and everything else falls through
  // the call path.
  //
  // The leading underscore is the tell, and it is the same encoder Va ran into: `encodeIdentifier`
  // prefixes JS RESERVED WORDS, so `typeof` -> `_typeof`. The emitted name could never have resolved
  // to anything, because `typeof` is not a legal JS identifier in the first place. The compiler
  // emitted a call to a function whose name it had just finished proving cannot exist.
  //
  // AF-006 UNDERSTATES IT: it names typeof and instanceof. `in` and `delete` are in the same
  // SPECIAL_FORMS line and fail identically -- `_in("a", o)`, `_delete(o.a)`. All four are fixed.
  // ===============================================================================================
  {
    name: "Vb/AF-006: `typeof` is the JS operator, not a call",
    source: `(let x 5)
(let s "hi")
(console.log (typeof x))
(console.log (typeof s))`,
    expect: ["number", "string"],
    emitted: { mustNot: [/_typeof\(/] },
    wasBroken:
      "`console.log(_typeof(x))` -> ReferenceError: _typeof is not defined. Compiled clean. AF-006.",
  },
  {
    name: "Vb/AF-006: `instanceof` is the JS operator, not a call",
    source: `(let d (new Date))
(console.log (instanceof d Date))`,
    expect: ["true"],
    emitted: { mustNot: [/_instanceof\(/] },
    wasBroken: "`_instanceof(d, Date)` -> ReferenceError. AF-006.",
  },
  {
    // Not named by AF-006, same defect, same line of SPECIAL_FORMS. Found by reading the list rather
    // than the finding.
    name: "Vb/AF-006: `in` and `delete` are operators too",
    source: `(let o {:a 1 :b 2})
(console.log (in "a" o))
(console.log (delete o.a))
(console.log (in "a" o))
(console.log (JSON.stringify o))`,
    expect: ["true", "true", "false", `{"b":2}`],
    emitted: { mustNot: [/_in\(/, /_delete\(/] },
    wasBroken:
      "`_in(\"a\", o)` and `_delete(o.a)` -> ReferenceError. AF-006 names only typeof/instanceof; " +
      "these two sit on the same SPECIAL_FORMS line and were broken identically.",
  },
  {
    // AF-006's motivating case, and it needed TWO fixes -- one compiler, one library.
    //
    // With `_typeof` gone, `alert` still died. Its guard read `(&& (typeof window) (!= window nil))`:
    // `typeof window` yields the STRING "undefined", which is truthy, so the `&&` always proceeded --
    // and `(!= window nil)` then TOUCHES an undeclared `window`, which is a ReferenceError, not a
    // false. Short-circuiting (Qc) does not save it; the left operand was never falsy.
    //
    // `typeof` is the only operator that may name a binding that does not exist, which is the whole
    // reason to reach for it in a browser check. The guard now compares against the string.
    name: "Vb/AF-006: std/io's exported `alert` is callable",
    source: `(import "std/io")
(alert "hello")`,
    expect: ["ALERT: hello"],
    wasBroken:
      "ReferenceError, twice over: `_typeof is not defined`, and once that was fixed, `window is not " +
      "defined` from the guard written to prevent exactly that. An EXPORTED stdlib function that " +
      "could not be called at all -- Phase S ticked ✅ with nothing exercising it.",
  },

  // ===============================================================================================
  // Vc / AF-007 -- a filterless `catch e` CRASHED THE BACKEND, and took LL0008 with it.
  //
  //     (try (...) catch e ((console.log e.message)))
  //       ->  TypeError: Cannot read properties of null (reading 'name')   at c.filter.type.name
  //
  // Not a diagnostic -- a raw Node stack trace out of the code generator, on ordinary valid code.
  //
  // ONE ENCODING MISTAKE, TWO VICTIMS. `catchFilter` returns `{name, type}` and sets `type: null`
  // when there is no `:of T`. So for `catch e`, `filter` is an OBJECT, not null. Everything that
  // asks "is this the default catch?" asks `!x.filter`, and gets FALSE:
  //
  //   - visitTryCatch treats it as a TYPED catch and reads `c.filter.type.name` -> null.name -> TypeError.
  //   - LL0008 ("Only one default catch block is allowed") tests
  //     `node.catch.filter((x) => !x.filter).length > 1`, which can never exceed 0. The rule was
  //     UNREACHABLE ON EVERY INPUT -- it has never once fired, and looked identical to a passing rule.
  //
  // "Filterless" means no TYPE, not no filter object: the filter still carries the NAME to bind. The
  // old default path proves nobody had run it -- it used `.body` and never bound the name at all, so
  // even a `catch e` that reached it would have left `e` undefined.
  // ===============================================================================================
  {
    name: "Vc/AF-007: a filterless `catch e` compiles, and binds e",
    source: `(try (
  (throw (Error "boom"))
)
catch e (
  (console.log "caught:" e.message)
))`,
    expect: ["caught: boom"],
    wasBroken:
      "`TypeError: Cannot read properties of null (reading 'name')` -- a RAW BACKEND CRASH, from " +
      "`c.filter.type.name`, on valid code. AF-007.",
  },
  {
    // The typed arm must still win, and the filterless one must be the fallback rather than a
    // competitor -- it is the chain's `else`, so ORDER of the two in the source must not matter.
    name: "Vc/AF-007: a typed catch still matches before the filterless fallback",
    source: `(fn go [x <- Int] -> String (
  (return (try (
    (if (== x 1) (throw (TypeError "typed")) (throw (Error "plain")))
    "unreachable"
  )
  catch e :of TypeError ("saw-TypeError")
  catch e ("saw-default")))
))
(console.log (go 1))
(console.log (go 2))`,
    expect: ["saw-TypeError", "saw-default"],
    wasBroken:
      "crashed before it could be asked. Once it compiles, this pins that the filterless arm is the " +
      "chain's `else` and does not swallow the typed one.",
  },
  {
    // LL0008 has never fired on any input. Its own predicate could not be true.
    name: "Vc/AF-007: LL0008 fires on two default catches",
    source: `(try (
  (throw (Error "boom"))
)
catch a ((console.log "one"))
catch b ((console.log "two")))`,
    expectDiagnostic: /LL0008/,
    wasBroken:
      "no diagnostic -- LL0008 tested `!x.filter`, which is never true, so 'Only one default catch " +
      "block is allowed' was unreachable on EVERY input. A dead rule is indistinguishable from a " +
      "passing one until something makes it fire.",
  },

  // ===============================================================================================
  // Vd / AF-045 -- `'"{(x)}"` called a PARAMETER because a function shared its name.
  //
  //     (defclass Box (fn area [] -> Int (return 7)))
  //     (fn show [area <- Int diag <- Int] -> String (return '"area={(area)} diag={(diag)}"))
  //
  //       ->  `area=${__ll_format_object(area())} diag=${__ll_format_object(diag)}`
  //                                       ^^^^^^ a CALL
  //
  // Identical parameters, identical construct, one expression. The sole difference is that a method
  // named `area` exists elsewhere in the program. `TypeError: area is not a function` -- the JS
  // parameter shadows the outer name, so the call target is the Int.
  //
  // D1 already ruled this, and Phase F already fixed it: "`(x)` is a CALL iff `x` names a FUNCTION",
  // answered by the SYMBOL TABLE, which knows `area` here is a parameter. The old answer came from
  // `this.functions` -- a flat list of every function NAME in the program, filled as codegen visits.
  //
  // The list survived as an `||` fallback, kept for the DOTTED case by its own comment: "a bare
  // member name is not a symbol this table can resolve". For a SIMPLE identifier `memberName` is just
  // the name, so the fallback answered "yes, something somewhere is called area" and OVERRODE the
  // scope-aware answer sitting right next to it. Two answers, and the wrong one won the `||`.
  // ===============================================================================================
  {
    name: "Vd/AF-045: an interpolated `(x)` binds the parameter, not a same-named function",
    source: `(defclass Box
  (fn area [] -> Int (return 7)))
(fn show [area <- Int diag <- Int] -> String
  (return '"area={(area)} diag={(diag)}"))
(console.log (show 3 4))`,
    expect: ["area=3 diag=4"],
    // The INTERPOLATION site specifically. A bare /area\(\)/ also matches the class's own method
    // DEFINITION (`area() { return 7; }`), which is legitimate JS and must stay -- the point is that
    // the parameter is not called, not that the string `area()` never appears.
    emitted: { mustNot: [/__ll_format_object\(area\(\)\)/] },
    wasBroken:
      "`TypeError: area is not a function`. Emitted `area()` for one parameter and `diag` for the " +
      "other, in the same interpolation, because a CLASS METHOD named `area` existed. AF-045.",
  },
  {
    // The GUARD, and the reason the fallback cannot simply be deleted: a real zero-arg call must
    // still call. D1's rule is "`(x)` is a CALL iff `x` names a FUNCTION" -- not "never".
    name: "Vd/AF-045: an interpolated `(f)` still CALLS a real function",
    source: `(fn seven [] -> Int (return 7))
(console.log '"n={(seven)}")`,
    expect: ["n=7"],
    wasBroken:
      "NOT broken -- a GUARD. Deleting the name-list fallback outright would make every `{(f)}` a " +
      "reference and print a function body. The symbol table says `seven` is a function; it is called.",
  },
  {
    // The dotted case the fallback was actually kept FOR. It must keep working -- the fix narrows the
    // list to that case rather than removing it.
    name: "Vd/AF-045: a dotted zero-arg method call still calls",
    source: `(defclass Box
  (fn area [] -> Int (return 7)))
(let b (Box))
(console.log (b.area))`,
    expect: ["7"],
    wasBroken:
      "NOT broken -- a GUARD on the narrowing. `(obj.m)` is what `this.functions` was still being " +
      "consulted for, and it is the one case that must not change.",
  },

  // ===============================================================================================
  // Ve / AF-046 -- `:comptime` could not see ANY imported symbol.
  //
  //     (import "std/math")
  //     (let :comptime x (* PI 2))
  //       ->  Comptime evaluation error: __ll_inlined_PI_1 is not defined
  //
  // The sandbox is handed a program that references a name nothing in it declares.
  //
  // `evaluateExpression` builds a JSTransformerAstVisitor and calls `visit(expr)` directly. Visiting
  // an imported symbol RENAMES it -- `PI` -> `__ll_inlined_PI_1`, so two modules' `PI` cannot collide
  // -- and records the definition to emit later. The definitions are then drained by `compile()` /
  // `visitProgram`, which this deliberately does not call. So the rename happened and the definition
  // never arrived: the evaluator resolved a post-inlining name against an environment that never had
  // it.
  //
  // The REPL hit exactly this and already solves it, at ReplSession.ts:589, with the comment that
  // names the trap: "`visitProgram`/`compile` -- which we deliberately do not call -- are what
  // normally drain these." Two external drivers of the same visitor; one knew.
  // ===============================================================================================
  {
    name: "Ve/AF-046: `:comptime` can see an imported symbol",
    source: `(import "std/math")
(let :comptime x (* PI 2))
(console.log x)`,
    expect: ["6.283185307179586"],
    // FOLDED, not merely computed. A `:comptime` that produced the right number by RUNNING at run
    // time would print the same thing -- the only proof it folded is that the import is gone from the
    // emitted JS and a literal stands where the expression was.
    emitted: { must: [/6\.283185307179586/], mustNot: [/__ll_inlined_PI/] },
    wasBroken:
      "`Comptime evaluation error: __ll_inlined_PI_1 is not defined`. Every imported symbol was " +
      "invisible to comptime -- so `:comptime` and `import`, two shipped features, could not be used " +
      "in the same expression. AF-046.",
  },
  {
    // A GUARD: the local case must keep working. It always did -- a local `(let :comptime ...)` needs
    // no inlining -- and the fix must not disturb it.
    name: "Ve/AF-046: a comptime fold with no imports still folds",
    source: `(fn :comptime double [n <- Int] -> Int (* n 2))
(let :comptime d (double 21))
(console.log d)`,
    expect: ["42"],
    emitted: { must: [/42/], mustNot: [/function double/] },
    wasBroken:
      "NOT broken -- a GUARD. The local fold worked; this pins that draining the inlined definitions " +
      "did not change it, and that the folded function is still gone from the output.",
  },

  // ===============================================================================================
  // Ya / D40 -- `return` in EXPRESSION position is REFUSED, pending HIR.
  //
  // THE RULING (D40) is that `return` returns from the enclosing FUNCTION, unconditionally, from any
  // code path. No positional caveats: a language where `return` works in a `cond` clause and silently
  // evaporates in a `match` arm is teaching a rule that does not exist.
  //
  // The emitter cannot honour that yet, and cannot be made to cheaply. Six forms, two behaviours,
  // measured:
  //
  //     return inside cond clause        -> returns from the function   OK
  //     return inside if (statement)     -> returns from the function   OK
  //     return inside when :then         -> returns from the function   OK
  //     return inside a match ARM        -> SWALLOWED
  //     return inside if (value position)-> SWALLOWED
  //     return as a ||/&& operand        -> SWALLOWED
  //
  // The split is mechanical: forms that emit STATEMENTS let `return` be a real return; forms that
  // emit an IIFE (match -- always; if-as-value; an operand) turn a non-local exit into a local one.
  // The IIFE arrived with P5c's `asExpression`, D25/Xb pinned cond's behaviour, and nothing ever
  // stated the rule -- so the two halves drifted apart in silence.
  //
  // Honouring A without an IR means statement hoisting -- `(let x (if c (return 1) 2))` becomes
  // `let x; if (c) { return 1; } else { x = 2; }`, and `(f (|| a (return b)) c)` has to hoist above
  // the call. That is ANF conversion: building an HIR badly, inline, without admitting it. It belongs
  // in the lowering path (AST -> HIR -> ESTree), not bolted onto the emitter.
  //
  // So: RULE A, REFUSE what cannot honour it. The project's own pattern -- D3/LL0023 refuses
  // `defmacro` by name as "Planned"; Qe refuses the mid-list rest D28 says is unbuilt. Ruled in, not
  // built, refuses rather than lies. When HIR lands, the diagnostic is deleted and these cases flip
  // from "refused" to "works" -- so they are also HIR's acceptance test, written before it starts.
  //
  // Nothing in examples/ or lib/ hits this. Measured: zero sites.
  // ===============================================================================================
  {
    name: "Ya/D40: `return` as a `||` operand is REFUSED, not swallowed",
    source: `(fn f [] -> String (
  (if (|| false (return "early")) (console.log "UNREACHABLE"))
  (return "fell-through")
))
(console.log (f))`,
    expectDiagnostic: /LL0103/,
    wasBroken:
      "printed `UNREACHABLE` and then `fell-through` -- the return became `(() => { return \"early\"; })()`, " +
      "so it returned from the ARROW and handed its value to `||` as an ordinary operand. Silent. AF-003.",
  },
  {
    // The one that matters: a match arm is where a Lisp programmer actually reaches for `return`, and
    // AF-003 never names it.
    name: "Ya/D40: `return` in a match arm is REFUSED, not swallowed",
    source: `(fn f [x <- Int] -> String (
  (match x { 1 => (return "match-early") _ => (return "match-other") })
  (return "fell-through")
))
(console.log (f 1))`,
    expectDiagnostic: /LL0103/,
    wasBroken:
      "printed `fell-through` -- BOTH arms' returns returned from the match's IIFE, not from `f`. " +
      "Unreported by the audit, and the likeliest place in the language to write a `return`.",
  },
  {
    name: "Ya/D40: `return` inside an if in VALUE position is REFUSED",
    source: `(fn f [c <- Boolean] -> String (
  (let r (if c (return "if-early") "no"))
  (return "fell-through")
))
(console.log (f true))`,
    expectDiagnostic: /LL0103/,
    wasBroken:
      "printed `fell-through`. A value-position `if` is a ternary, and each branch is coerced to an " +
      "expression -- so the return was IIFE'd exactly as a `||` operand is. Also unreported.",
  },
  {
    // THE GUARD THAT DEFINES THE BOUNDARY. These three are the forms that emit STATEMENTS, they work
    // today, and D25/Xb pins the cond one under "The three that must NOT move". The diagnostic must
    // not touch them -- if it does, it has misidentified position for form.
    name: "Ya/D40: `return` in cond / if / when still returns from the FUNCTION",
    source: `(fn viaCond [x <- Int] -> String (
  (cond ((> x 0) (return "cond-early")))
  (return "cond-fell")
))
(fn viaIf [x <- Int] -> String (
  (if (> x 0) (return "if-early"))
  (return "if-fell")
))
(fn viaWhen [x <- Int] -> String (
  (when (> x 0) :then ((return "when-early")))
  (return "when-fell")
))
(console.log (viaCond 1))
(console.log (viaIf 1))
(console.log (viaWhen 1))`,
    expect: ["cond-early", "if-early", "when-early"],
    wasBroken:
      "NOT broken -- THE GUARD. These are the statement-position forms, and they are the half of the " +
      "language that already honours D40. A diagnostic that fires here has confused FORM with POSITION.",
  },
  {
    // A nested function's `return` returns from THAT function, and is none of this rule's business.
    // The scan must stop at a function boundary or it reports the most ordinary code in the language.
    // The lambda is deliberately NOT called here, and the reason is a separate bug found while
    // writing this: `(g)` on a match-bound lambda does not call it. `(let direct (fn [] -> Int
    // (return 5)))` then `(direct)` gives 5, but binding the SAME lambda through a `match` gives
    // `[Function (anonymous)]` -- D1's rule is "`(x)` is a CALL iff `x` names a FUNCTION", and the
    // checker infers `direct` as a function while a match's result stays un-inferred. Identical
    // bindings, one calls, one silently hands back the function object. Filed, not this phase's.
    //
    // So this asserts what it is actually about: the arm holds a nested fn whose `return` is its own
    // business, the program COMPILES (no LL0103), and it runs.
    name: "Ya/D40: a nested fn's `return` inside a match arm is not refused",
    source: `(fn f [x <- Int] -> Int (
  (let g (match x { 1 => (fn [] -> Int (return 5)) _ => (fn [] -> Int (return 9)) }))
  (return 0)
))
(console.log (f 1))`,
    expect: ["0"],
    wasBroken:
      "NOT broken -- a GUARD on the scan's stopping rule. The lambda's `return` returns from the " +
      "LAMBDA, which is exactly right; a walk that does not stop at a function boundary would refuse " +
      "the most ordinary code in the language.",
  },

  // ===============================================================================================
  // Yb -- a trailing `cond` / `when` returned `undefined` against a DECLARED return type.
  //
  //     (fn f [x <- Int] -> String (cond ((> x 0) "pos") (true "neg")))   ->  undefined
  //     (fn f [x <- Int] -> String (when (> x 0) :then ("pos")))          ->  undefined
  //
  // Silent, and it defeats the checker exactly as AF-043 did: the function is certified `-> String`
  // and hands back undefined.
  //
  // The desugarer turns a function's tail expression into an explicit `(return e)`. `wrapIfValue`
  // special-cases a trailing `if` -- the return goes on each BRANCH -- and `isValueTail` lets a
  // trailing `match` through, so both yield their value. `cond` and `when` are in `isValueTail`'s
  // exclusion set and get neither treatment.
  //
  // Four trailing forms, two answers:  if OK · match OK · cond undefined · when undefined.
  //
  // NOT A RULING, and that is the point. `isValueTail`'s comment says "whether a trailing `if` should
  // be an expression is a RULING, not a detail to slip into a refactor" -- and the ruling has already
  // shipped, twice: `if` yields its branch and `match` yields its arm. `cond` is `if`'s own shape (a
  // dispatch chain) and `when` is `if` without an else. They are not a deliberate exclusion; they are
  // the two that nobody came back for. This makes the language answer once.
  //
  // Partiality is unchanged and is already the rule for `if`: `(if c 1)` with no else yields undefined
  // when c is false, and so does a `cond` with no matching clause. That is D9's problem, not this one.
  // ===============================================================================================
  {
    name: "Yb: a trailing `cond` yields its clause's value",
    source: `(fn grade [x <- Int] -> String (cond ((> x 0) "pos") (true "neg")))
(console.log (grade 1))
(console.log (grade (- 0 1)))`,
    expect: ["pos", "neg"],
    wasBroken:
      "`undefined`, from a fn the checker had certified `-> String`. `cond` sits in `isValueTail`'s " +
      "exclusion set while `if` -- the same shape -- is special-cased above it and works.",
  },
  {
    name: "Yb: a trailing `when` yields its body's value",
    source: `(fn f [x <- Int] -> String (when (> x 0) :then ("pos")))
(console.log (f 1))`,
    expect: ["pos"],
    wasBroken: "`undefined`. `when` is `if` without an else, and was excluded where `if` is not.",
  },
  {
    // THE GUARD THAT MUST NOT MOVE. D25/Xb pins `(cond ((>= score 90) (return "A")) ...)` under "The
    // three that must NOT move" -- an explicit `return` in a clause returns from the FUNCTION, and the
    // clause emits an else-if CHAIN, not an IIFE. Wrapping a body that is ALREADY a return would
    // produce `return (return "A")`; `isValueTail` refuses that, and this proves it still does.
    name: "Yb: an explicit `return` in a cond clause is not double-wrapped",
    source: `(fn grade [score <- Int] -> String (
  (cond
    ((>= score 90) (return "A"))
    ((>= score 80) (return "B"))
    (true          (return "F")))
))
(console.log (grade 95))
(console.log (grade 50))`,
    expect: ["A", "F"],
    wasBroken:
      "NOT broken -- THE GUARD, and the one a careless fix breaks. D25/Xb already pins this shape; " +
      "the wrap must decline a body that is already a `(return e)`.",
  },
  {
    // The other half of the family, pinned so the four forms stay in agreement rather than drifting
    // apart again the moment someone edits one of them.
    name: "Yb: trailing if / match still yield their value",
    source: `(fn viaIf [x <- Int] -> String (if (> x 0) "pos" "neg"))
(fn viaMatch [x <- Int] -> String (match x { 1 => "one" _ => "other" }))
(console.log (viaIf 1))
(console.log (viaMatch 1))`,
    expect: ["pos", "one"],
    wasBroken:
      "NOT broken -- a GUARD. These two are why cond/when are a BUG and not a ruling: the language " +
      "already decided a trailing control form yields its value.",
  },

  // ===============================================================================================
  // Yd -- a `match` had NO TYPE, so `(x)` on a match-bound lambda did not call it.
  //
  //     (let direct   (fn [] -> Int (return 5)))                    (direct)   -> 5
  //     (let viaIf    (if true (fn [] -> Int (return 3)) ...))      (viaIf)    -> 3
  //     (let viaMatch (match 1 { 1 => (fn [] -> Int (return 7)) ... })) (viaMatch) -> [Function]
  //
  // Identical bindings of identical lambdas. Two call; one silently hands back the function object.
  //
  // D1 rules `(x)` is a CALL iff `x` names a FUNCTION, answered from the symbol table -- and the
  // table answers from the binding's INFERRED type. `inferExpressionType` has a `case "if"` (a
  // findCommonType over the branches) and NO case for `match` at all: the checker contains zero
  // references to MatchNode. So a match's type was Unknown, `kind === "function"` was false, and the
  // grouping won.
  //
  // The silent half is what makes it this session's shape rather than a missing feature: nothing
  // reports that `(viaMatch)` did not call. The program runs and prints a function.
  // ===============================================================================================
  {
    name: "Yd: `(x)` calls a MATCH-bound lambda",
    source: `(let viaMatch (match 1 { 1 => (fn [] -> Int (return 7)) _ => (fn [] -> Int (return 9)) }))
(console.log (viaMatch))`,
    expect: ["7"],
    wasBroken:
      "printed `[Function (anonymous)]`. The match had no inferred type, so D1's \"a call iff it " +
      "names a function\" answered no, and `(viaMatch)` was read as a grouping.",
  },
  {
    // A match's type is its arms' common type, exactly as an `if`'s is its branches'.
    //
    // Asserted through a DIAGNOSTIC, deliberately. The obvious test -- bind a match to `n` and print
    // `(+ n 1)` -- passes with or without the fix: gradual typing computes the right VALUE from an
    // Unknown, so stdout proves nothing about the type. Only a type ERROR can tell Unknown from Int.
    name: "Yd: a match's type is the common type of its arms, and is enforced",
    source: `(let n (match 1 { 1 => 10 _ => 20 }))
(let s <- String n)
(console.log s)`,
    expectDiagnostic: /LL0200/,
    wasBroken:
      "SILENT. The match was Unknown, so `n` was Unknown, so assigning it to a String was gradual and " +
      "passed -- the checker had nothing to compare. `if` typed this correctly; `match` had no case.",
  },
  {
    // ...and the value side still works, so the fix types the match without changing what it does.
    name: "Yd: a match's value is unchanged by having a type",
    source: `(let n (match 1 { 1 => 10 _ => 20 }))
(console.log (+ n 1))
(let s (match 2 { 1 => "one" _ => "many" }))
(console.log (s.toUpperCase))`,
    expect: ["11", "MANY"],
    wasBroken:
      "NOT broken -- a GUARD. These were right while the type was absent (gradual typing), and must " +
      "stay right now that it is not.",
  },
  {
    // The control that proves it was `match` specifically, and the shape the fix copies.
    name: "Yd: an if-bound and a directly-bound lambda still call",
    source: `(let direct (fn [] -> Int (return 5)))
(let viaIf (if true (fn [] -> Int (return 3)) (fn [] -> Int (return 4))))
(console.log (direct))
(console.log (viaIf))`,
    expect: ["5", "3"],
    wasBroken:
      "NOT broken -- the CONTROL. `if` has a `case` in inferExpressionType and `match` did not; these " +
      "two working is what located the bug.",
  },
  {
    // The bug UNDER the bug, found because giving `match` a type made something read an arm's body
    // for the first time. `bindingIdentifiers` was written for destructuring (D16) and type patterns
    // arrived later (D27), so `type-pattern` fell to its `default: return` and bound NOTHING -- the
    // symbol table had no `n`, and `n :of Int => n` referenced a name nothing had defined.
    //
    // It could not be observed before: no pass type-checked a match arm's body, so nobody ever looked
    // `n` up. A binding that nothing resolves cannot be missing. The D27 cases above passed all along
    // because they only assert the VALUE, and codegen binds the arm itself.
    //
    // HONESTLY: this could not go RED before Yd, and that is the finding rather than a gap in the
    // test. With no match inference nothing resolved `n`, so the missing binding had no observer. It
    // went red DURING Yd -- the `case "match"` alone turned the four D27 cases red with
    // `'n' is not defined` -- which is how it was found. This pins it so it cannot return.
    name: "Yd: a `:of` type pattern BINDS its name, and the name is usable",
    source: `(let ok (match 5 { n :of Int => (+ n 1) _ => 0 }))
(console.log ok)`,
    expect: ["6"],
    wasBroken:
      "`'n' is not defined` -- the PATTERN's OWN binding, reported the instant anything type-checked " +
      "the arm. `bindingIdentifiers` had no `type-pattern` case, so `:of` registered no name at all.",
  },

  // ===============================================================================================
  // Ye / D12 -- `cond`'s default clause is spelled `:else`, and it did not parse.
  //
  //     (cond ((> x 0) "pos") (:else "neg"))
  //       ->  Expecting token of type --> RParen <-- but found --> ':else' <--
  //
  // D12's ruling, verbatim: "`cond`'s default clause is spelled `:else`." `ElseModKw` exists and is
  // consumed by the `if`/`when` and `for` rules; `condCase` has never referenced it. A ruling that
  // was never implemented -- and the corpus routed around it in silence, writing
  // `(true (return "F"))` with a `;; Default case` comment next to it.
  //
  // `:else` is SUGAR for a `true` condition, which is what `(true ...)` already was: a clause whose
  // condition happens to be the literal true. Same AST, so codegen, the checker and every golden are
  // untouched -- the spelling is the whole change. `(true ...)` keeps working precisely because it
  // was never special: it is an ordinary clause, and D12 names the DEFAULT's spelling, not a
  // prohibition on writing `true`.
  // ===============================================================================================
  {
    name: "Ye/D12: `cond`'s default clause is spelled `:else`",
    source: `(fn grade [x <- Int] -> String (
  (cond
    ((>= x 90) (return "A"))
    ((>= x 80) (return "B"))
    (:else     (return "F")))
))
(console.log (grade 95))
(console.log (grade 85))
(console.log (grade 10))`,
    expect: ["A", "B", "F"],
    wasBroken:
      "`Expecting token of type --> RParen <-- but found --> ':else' <--`. D12 ruled this spelling " +
      "and `condCase` never referenced ElseModKw. The corpus wrote `(true ...)` instead, with a " +
      "comment explaining that it was the default.",
  },
  {
    // `:else` desugars to a `true` condition, so the two spellings must be indistinguishable -- that
    // is what makes this a one-line grammar change and not a codegen one.
    name: "Ye/D12: `:else` and `(true ...)` are the same clause",
    source: `(fn a [x <- Int] -> String ((cond ((> x 0) (return "pos")) (:else (return "neg")))))
(fn b [x <- Int] -> String ((cond ((> x 0) (return "pos")) (true  (return "neg")))))
(console.log (a 1) (a (- 0 1)))
(console.log (b 1) (b (- 0 1)))`,
    expect: ["pos neg", "pos neg"],
    wasBroken:
      "NOT broken for `(true ...)` -- a GUARD. `true` was never a special case, just a clause whose " +
      "condition is the literal true, so it must keep working exactly as it did.",
  },
  {
    // Yb's rule meets D12's: a trailing `cond` yields its clause's value, and `:else` is a clause.
    name: "Ye/D12: an `:else` clause yields its value in a trailing cond",
    source: `(fn pick [x <- Int] -> String (cond ((> x 0) "pos") (:else "neg")))
(console.log (pick 1))
(console.log (pick (- 0 1)))`,
    expect: ["pos", "neg"],
    wasBroken:
      "unparseable, and then (before Yb) undefined. The two fixes compose: `:else` is a clause, and a " +
      "trailing cond returns its clause's value.",
  },

  // ===============================================================================================
  // Za / D41 -- `(x :of T)` is a TYPE GUARD in expression position, and it NARROWS.
  //
  // The corpus asked for `(status is String)` -- infix, C#/TypeScript-shaped, and `ELL0210 'is' is not
  // defined`. It was aspirational syntax, the same family as `(Fn [] Int)` in 20_scope: a file
  // describing a language nobody built.
  //
  // `:of` is the ruled spelling (D27) and it already means exactly this in a match arm:
  // `(match x { n :of Int => ... })`. This is the same question asked in expression position, and it
  // emits the SAME runtime test -- `__ll_is_type(v, "T")` -- so the two positions cannot drift apart.
  //
  // AND IT NARROWS, which is the whole point. D9g's comment makes the argument: "LL0205 without an
  // escape hatch does not make `T?` unsafe, it makes it UNUSABLE: the nil-check you just wrote would
  // not be believed." A type guard that does not narrow makes UNIONS unusable the same way -- and
  // that is exactly when a language grows an `as`, to lie its way past a check it just performed.
  // Narrowing is why l-lang does not need one.
  // ===============================================================================================
  {
    name: "Za/D41: `(x :of T)` is a Bool, and discriminates",
    source: `(fn describe [x <- Int | String] -> String (
  (if (x :of String) (return "string"))
  (return "int")
))
(console.log (describe "hi"))
(console.log (describe 5))`,
    expect: ["string", "int"],
    // The SAME runtime test a match arm uses. If these ever diverge, `(x :of T)` and
    // `(match x { _ :of T => ... })` would answer differently for one value, which is the bug class
    // this whole session has been about.
    emitted: { must: [/__ll_is_type\(/] },
    wasBroken:
      "`(x is String)` was `ELL0210 'is' is not defined`, and `(x :of String)` was a parse error " +
      "(`Expecting RParen but found ':of'`). There was no way to ask a value's type in expression " +
      "position at all.",
  },
  {
    // THE POINT. Without narrowing this is LL0200 -- measured: `(mut s <- Int | String 5)` then
    // `(let t <- String s)` reports "cannot assign Int | String to String". The guard must make the
    // checker believe what it just proved.
    name: "Za/D41: a `:of` guard NARROWS the union in the then-branch",
    source: `(fn shout [x <- Int | String] -> String (
  (if (x :of String)
    (return (x.toUpperCase)))
  (return "not-a-string")
))
(console.log (shout "hi"))
(console.log (shout 5))`,
    expect: ["HI", "not-a-string"],
    wasBroken:
      "n/a -- `:of` did not exist. Without narrowing `x` stays `Int | String` inside the guard, so " +
      "`x.toUpperCase` is a member of a union that may be an Int. The guard would have proved " +
      "something the checker then refused to believe -- which is how a language ends up with `as`.",
  },
  {
    // The guard must not narrow where it did not prove anything. `x` is still the union AFTER the if.
    name: "Za/D41: narrowing does not leak past the guard",
    source: `(fn f [x <- Int | String] -> String (
  (if (x :of String) (console.log "in-guard"))
  (let t <- Int | String x)
  (return "done")
))
(console.log (f 5))`,
    expect: ["done"],
    wasBroken:
      "NOT broken -- a GUARD on the scope. `withNarrowed` binds in a FRESH SCOPE and exits it, so the " +
      "narrowed type must not survive the branch. If it leaked, `x` would be String after the if and " +
      "the union assignment below would report.",
  },

  // ===============================================================================================
  // Zb -- A COMMENT INVERTED AN `if`.
  //
  //     (if (x :of String)
  //         ; a note
  //         (console.log "hi"))
  //
  //       ->  then = the COMMENT
  //           else = (console.log "hi")
  //
  // The body fired only when the guard was FALSE. Silently, at exit 0. A comment is the one thing in
  // a program nobody expects to change behaviour, which is exactly why it was invisible.
  //
  // `if`/`when`/`cond`/`while` assign their parts BY POSITION -- D12 keeps them positional and made
  // only `for` named-clause -- and a comment parses as an ordinary expression, so it TOOK A SLOT and
  // shifted everything after it by one.
  //
  // D12 names this exact bug class, about `for`: "The old builder walked a flat `expressions` array
  // with a moving index and guessed each clause's role from its POSITION ... that positional shuffle
  // is exactly the bug the audit meant by 'the for-each feature and the for-each bug are the same
  // code'." D12's cure was to make `for`'s roles keyword-based. The forms it left positional kept the
  // disease, and nobody went back for them.
  //
  // FOUND BY RUNNING SABAKA'S OWN EXAMPLE, not by reading it: `03-types/00_type_basics.lisp` has a
  // comment between the `:of` guard and its body, so the guard printed nothing when it matched. The
  // file compiled clean the whole time. AF-047 covers comments in `cond`/`match` clause LISTS, where
  // they are a hard ERROR; this is the same class one step worse -- an `if` runs, inverted.
  // ===============================================================================================
  {
    name: "Zb: a comment does not take the `then` slot of an `if`",
    source: `(let x <- Int | String "s")
(if (x :of String)
    ; a comment between the condition and the body
    (console.log "THEN fired"))
(if (x :of Int)
    ; and here
    (console.log "ELSE fired -- the guard was FALSE"))`,
    // `x` IS a String: the first must fire, the second must not. Before the fix it was exactly
    // inverted -- the second printed and the first did not.
    expect: ["THEN fired"],
    wasBroken:
      "printed `ELSE fired -- the guard was FALSE` and NOT `THEN fired`. The comment became the THEN " +
      "branch and the body became the ELSE, so every commented `if` in the language ran backwards.",
  },
  {
    name: "Zb: a comment does not shift `when` / `while` / `cond` bodies either",
    source: `(mut n <- Int 0)
(when (== n 0) :then (
    ; a comment first
    (console.log "when fired")))
(while (< n 2) (
    ; and here
    (n := (+ n 1))))
(console.log n)
(console.log (cond
    ((> n 5) "big")
    (:else   "small")))`,
    expect: ["when fired", "2", "small"],
    wasBroken:
      "the same positional shift: `when`'s condition, `while`'s condition and a `cond` clause's " +
      "condition/body all come from `expressions[i]`, so a leading comment displaced each of them. " +
      "One helper now filters comments for all four, so they cannot disagree.",
  },
  {
    // THE TRADE, pinned so it is a decision and not a surprise.
    //
    // A comment in a BLOCK still reaches the output -- that path is untouched. A comment in a
    // POSITIONAL SLOT is dropped from the output: it is not a value, so it has no slot to be emitted
    // from. It used to survive only by BEING the then-branch, which is the bug.
    //
    // Losing it costs a comment in the emitted JS, which nobody reads; keeping it cost an inverted
    // `if`, which everybody runs. The source still has it. If trivia ever needs to round-trip (the
    // llang -> llang emitter is the only consumer that would care), that is attachment machinery and
    // a phase of its own -- not a slot.
    name: "Zb: a block comment is still emitted; a positional one is dropped",
    source: `(fn f [] -> Int (
  ;; a block comment
  (return 1)
))
(if true
    ; a positional comment
    (console.log (f)))`,
    expect: ["1"],
    emitted: { must: [/a block comment/], mustNot: [/a positional comment/] },
    wasBroken:
      "NOT broken -- a GUARD on the trade. The positional comment WAS emitted before, as the `then` " +
      "branch it had stolen.",
  },

  // ===============================================================================================
  // Zc -- `:of` FAILED OPEN. `getTypeName` invented a name it could not honour.
  //
  //     (d :of Int | String)   -> TRUE   for a Dog. Matched EVERYTHING.
  //     (5 :of Int[])          -> TRUE   inverted
  //     ([1 2 3] :of Int[])    -> FALSE  inverted
  //
  // TWO defects in one helper:
  //
  // 1. THE 'Any' HOLE. `getTypeName` handles 5 of 11 TypeNode kinds and falls through to
  //    `return 'Any'`; `__ll_is_type` has `case 'any': return true`. So a union/tuple/map/intersection
  //    at a `:of` site emitted `__ll_is_type(v, "Any")` and matched every value -- including null and
  //    undefined, which the nominal branch explicitly rejects. Reachable from BOTH `:of` positions and
  //    from operator registration, where `[a <- Int | String]` registers the param as "Any" and the
  //    overload then matches every argument.
  //
  // 2. THE DROPPED ARRAY FLAG. `Int[]` carries `array: true` on the type node; getTypeName recursed
  //    past it into the element name. So `Int[]` tested as "Int" -- exactly inverted.
  //
  // Za's narrowing made (1) worse: the checker BELIEVED it and bound a Dog as `Int | String`.
  //
  // FAIL CLOSED. A name the runtime cannot honour is not a name: `getTypeName` returns undefined and
  // the callers REFUSE (LL0104). The precedent is in-tree and explicit -- `functional-pattern`
  // (DECISIONS.md:2867-2870): "a closure does not carry its parameter types at run time, so there is
  // nothing to test against." Where the runtime carries no evidence, refuse and say so. Same shape as
  // D40/LL0103.
  //
  // ERASURE OF ARGUMENTS IS NOT THE LIE, and stays: `:of Iterable<Int>` erases to "Iterable" on
  // purpose (Ea's extension dispatch depends on it), and `Int[]` now tests ARRAY-NESS the same way.
  // Inventing a name for a type that HAS none is the lie.
  // ===============================================================================================
  {
    // The 'Any' hole's OWN case, kept as the regression guard for it.
    //
    // Zc's version of this asserted LL0104 -- because Zc's answer to "no runtime name" was to refuse.
    // Zd gave unions a real test, so the refusal is superseded and the assertion is now the STRONGER
    // one it was always standing in for: a Dog is not an `Int | String`. If the hole ever reopens,
    // this fails.
    name: "Zc: the 'Any' hole stays shut -- a Dog is not an `Int | String`",
    source: `(defclass Dog (fn bark [] -> String (return "woof")))
(let d (Dog))
(console.log (if (d :of Int | String) "matched" "correctly-false"))`,
    expect: ["correctly-false"],
    emitted: { mustNot: [/__ll_is_type\([^)]*"Any"\)/] },
    wasBroken:
      "printed `matched` -- for a DOG. getTypeName fell through to 'Any' and __ll_is_type's " +
      "`case 'any': return true` matched every value in the language.",
  },
  {
    // NOT refused -- FIXED. Array-ness is answerable; the element type is erased exactly as a
    // generic's arguments are.
    name: "Zc: `:of T[]` tests ARRAY-NESS, and is no longer inverted",
    source: `(let xs [1 2 3])
(console.log (if (xs :of Int[]) "array" "not-array"))
(console.log (if (5 :of Int[]) "array" "not-array"))`,
    expect: ["array", "not-array"],
    wasBroken:
      "EXACTLY INVERTED: `([1 2 3] :of Int[])` was FALSE and `(5 :of Int[])` was TRUE. The `array` " +
      "flag rides on the type node and getTypeName recursed straight past it, so `Int[]` tested as " +
      "`Int`.",
  },
  {
    name: "Zc: `:of` on a tuple / map type is REFUSED",
    source: `(let x 5)
(console.log (if (x :of [Int String]) "yes" "no"))`,
    expectDiagnostic: /LL0104/,
    wasBroken: "`Any` -> matched. A tuple type has no runtime name and nothing tested its shape.",
  },
  {
    // The OTHER `:of` position must refuse the same shapes. Za's own header says it: "`(x :of T)` and
    // `(match x { _ :of T => ... })` ask one question and must not be able to answer it differently."
    // A refusal is an answer.
    // A TUPLE, not a union -- unions became testable in Zd, so the shape that still has no runtime
    // test is what proves the two positions agree about refusing.
    name: "Zc: a match `:of` refuses the same types the expression `:of` does",
    source: `(let x 5)
(console.log (match x {
  v :of [Int String] => "matched"
  _                  => "no"
}))`,
    expectDiagnostic: /LL0104/,
    wasBroken:
      "matched -- the match arm went through the same 'Any' hole via the same helper. Both positions " +
      "share `typeTest` now, so a type is testable in both or neither.",
  },
  {
    // The third caller, and the least obvious: an operator's params are registered BY NAME for
    // overload dispatch, so a union param registered as "Any" and the overload matched every
    // argument -- a silent wrong dispatch, not a failed test.
    name: "Zc: an operator param the runtime cannot test is REFUSED",
    source: `(defstruct P (mut :ctor v <- Int 0))
(fn :operator + [a <- Int | String b <- P] -> P (return b))
(console.log "declared")`,
    expectDiagnostic: /LL0104/,
    wasBroken:
      "registered the param as `Any`, so `__ll_op_registry.lookup` matched this overload for ANY " +
      "first argument. Unsound dispatch, and invisible.",
  },
  {
    // THE GUARD. Everything the runtime CAN answer must keep answering -- including the deliberate
    // generic-argument erasure Ea's dispatch depends on.
    name: "Zc: bare names, classes and generics still test",
    source: `(defclass Dog (fn bark [] -> String (return "woof")))
(let d (Dog))
(console.log (if (d :of Dog) "dog" "no"))
(console.log (if (5 :of Int) "int" "no"))
(console.log (if ("s" :of String) "str" "no"))
(console.log (if (true :of Boolean) "bool" "no"))
(console.log (if (5 :of String) "wrong" "correctly-false"))`,
    expect: ["dog", "int", "str", "bool", "correctly-false"],
    wasBroken:
      "NOT broken -- THE GUARD. These are the cases the runtime genuinely answers, and failing closed " +
      "must not touch them.",
  },

  // ===============================================================================================
  // Zd -- `:of` on a union / intersection / optional, SOUNDLY.
  //
  // Zc refuses these because they have no runtime NAME. But they are perfectly DECIDABLE -- they just
  // are not a name. A union is an `||` of its members' tests, an intersection an `&&`, and `T?` is
  // `T | nil` (D9), so it is a union with a nil check. What was missing is that `getTypeName` returns
  // a STRING, and a compound type cannot be one; the test has to be built as a SHAPE.
  //
  // `typeTest` is that: one helper, both `:of` positions -- the same discipline Vc used for
  // `isDefaultCatch` and D38 for the diagnostics registry. Za's header states the invariant: the two
  // positions "ask one question and must not be able to answer it differently."
  //
  // A member the runtime still cannot test keeps refusing (LL0104). Decidability composes: a union is
  // testable exactly when every member is.
  // ===============================================================================================
  {
    name: "Zd: `:of` on a union discriminates",
    source: `(defclass Dog (fn bark [] -> String (return "woof")))
(fn what [x <- Int | String | Dog] -> String (
  (if (x :of Int | String) (return "int-or-string"))
  (return "other")
))
(console.log (what 5))
(console.log (what "s"))
(console.log (what (Dog)))`,
    expect: ["int-or-string", "int-or-string", "other"],
    emitted: { must: [/__ll_is_type\([^)]*"Int"\)\s*\|\|/] },
    wasBroken:
      "before Zc: TRUE for the Dog too -- the 'Any' hole. After Zc: refused. Now it answers, by " +
      "testing each member.",
  },
  {
    // `T?` is `T | nil` (D9). Testing it as `T` drops the nil arm, so the one value that is
    // unambiguously a `String?` answered FALSE.
    name: "Zd: `:of T?` includes nil",
    source: `(mut s <- String? nil)
(console.log (if (s :of String?) "nil-is-optional" "no"))
(s := "hi")
(console.log (if (s :of String?) "str-is-optional" "no"))
(console.log (if (5 :of String?) "wrong" "int-is-not"))`,
    expect: ["nil-is-optional", "str-is-optional", "int-is-not"],
    wasBroken:
      "`(nil :of String?)` was FALSE. `String?` tested as `String`, so nil -- the one value that is " +
      "certainly a String? -- was rejected by its own type.",
  },
  {
    // THE SIDE-EFFECT GUARD. A union references the value once PER MEMBER, so a naive expansion
    // evaluates it N times. `(f x)` must run once.
    name: "Zd: the guarded expression is evaluated ONCE",
    source: `(mut calls <- Int 0)
(fn bump [] -> Int (
  (calls := (+ calls 1))
  (return 5)
))
(console.log (if ((bump) :of Int | String) "matched" "no"))
(console.log calls)`,
    expect: ["matched", "1"],
    wasBroken:
      "n/a -- a GUARD on the expansion. `A(v) || B(v)` names `v` twice; if `v` is a call, it runs " +
      "twice. The match position is safe (it tests a temp), the expression position is not.",
  },
  {
    // Both positions, one helper. A match arm must answer identically.
    name: "Zd: a match `:of` on a union discriminates too",
    source: `(defclass Dog (fn bark [] -> String (return "woof")))
(fn what [x <- Int | String | Dog] -> String (
  (return (match x {
    v :of Int | String => "int-or-string"
    _                  => "other"
  }))
))
(console.log (what 5))
(console.log (what (Dog)))`,
    expect: ["int-or-string", "other"],
    wasBroken:
      "the same 'Any' hole via the same helper, then the same refusal. Both positions share " +
      "`typeTest` now, so they cannot drift.",
  },
  {
    // Decidability COMPOSES: a union is testable exactly when every member is. One untestable member
    // and the whole thing refuses -- it must not silently test the members it happens to like.
    name: "Zd: a union with an untestable member still refuses",
    source: `(let x 5)
(console.log (if (x :of Int | [Int String]) "yes" "no"))`,
    expectDiagnostic: /LL0104/,
    wasBroken:
      "NOT broken -- a GUARD on the composition. A tuple has no runtime test, so a union containing " +
      "one has none either. Testing just the Int arm would answer a DIFFERENT question than the one " +
      "written.",
  },

  // ===============================================================================================
  // Ze / D43 -- Int vs Real is decided STATICALLY, because the runtime cannot.
  //
  //     (5.5 :of Real)  ->  FALSE     'real' is absent from __ll_is_type's switch
  //     ("c" :of Char)  ->  FALSE     'char' is absent too
  //
  // And the obvious fix -- adding `case 'real': typeof val === 'number'` -- IS the collapse: `case
  // 'int'` is the identical test, so both would answer true for both. JS has ONE number; `5.0 === 5`.
  // Probed: a primitive cannot be tagged (property assign, defineProperty, WeakMap and Symbol all
  // throw); BigInt breaks arithmetic, JSON and Math; boxing unboxes at the first operator and prints
  // `[Number: 5]`. There is no runtime answer to buy.
  //
  // THE CHECKER ALREADY KNOWS. `(let x <- Real 5.0)` is a Real; only the RUNTIME cannot see it. So
  // `:of Int`/`:of Real` never reach `__ll_is_type` -- they are decided from the type channel
  // (`context.nodeTypes`), which is what D34/Phase E already rules: when the static type is known,
  // lower at compile time and do not build runtime machinery.
  //
  //     x : Int          ->  fold true
  //     x : Real         ->  fold false
  //     x : Int | String ->  typeof === number     exact: no Real in the union
  //     x : Int | Real   ->  LL0104                genuinely undecidable
  //     x : Unknown      ->  typeof === number     gradual -- see below
  //
  // THE UNKNOWN ARM IS A CONCESSION, and a deliberate one. "Static-first" needs a static type, and
  // gradual typing means the channel is often empty. Refusing on an Unknown would contradict the rule
  // this compiler states everywhere -- "a condition we could not type is not a condition we can call
  // wrong". So the collapse survives EXACTLY where the checker does not know, which is where every
  // other gradual concession already lives. The only refusal is the case that is undecidable even in
  // principle.
  //
  // `Char` is different and is simply FIXED: a Char IS a one-character string, and that is testable.
  // ===============================================================================================
  {
    name: "Ze/D43: `:of Real` and `:of Char` answer at all",
    source: `(console.log (if (5.5 :of Real) "real" "no"))
(console.log (if ("c" :of Char) "char" "no"))
(console.log (if ("ab" :of Char) "wrong" "not-a-char"))`,
    expect: ["real", "char", "not-a-char"],
    wasBroken:
      "`(5.5 :of Real)` and `(\"c\" :of Char)` were both FALSE -- 'real' and 'char' were absent from " +
      "__ll_is_type's switch, so the arms were silently unreachable. Zero corpus tests covered either.",
  },
  {
    // The static half: the checker knows, so the runtime is never asked. `5.5` is a Real and `5` an
    // Int -- measured via LL0200's own message.
    name: "Ze/D43: Int vs Real is decided statically, not by typeof",
    source: `(let i 5)
(let r 5.5)
(console.log (if (i :of Int) "i-is-int" "no"))
(console.log (if (r :of Int) "wrong" "r-is-not-int"))
(console.log (if (i :of Real) "wrong" "i-is-not-real"))
(console.log (if (r :of Real) "r-is-real" "no"))`,
    expect: ["i-is-int", "r-is-not-int", "i-is-not-real", "r-is-real"],
    // The whole point: no runtime test is emitted for a decision the checker already made.
    emitted: { mustNot: [/__ll_is_type\([^)]*"Int"\)/, /__ll_is_type\([^)]*"Real"\)/] },
    wasBroken:
      "`(r :of Int)` would be TRUE under any typeof-based test -- JS has one number and 5.0 === 5. " +
      "The distinction is real STATICALLY and only statically.",
  },
  {
    // A union WITHOUT Real is exact: typeof discriminates Int from String perfectly.
    name: "Ze/D43: `:of Int` on a Real-free union still tests at run time",
    source: `(fn what [x <- Int | String] -> String (
  (if (x :of Int) (return "int"))
  (return "string")
))
(console.log (what 5))
(console.log (what "s"))`,
    expect: ["int", "string"],
    wasBroken:
      "NOT broken -- a GUARD. The ambiguity is Int-vs-Real ONLY. A union with no Real in it is " +
      "perfectly discriminable, and refusing it would be over-correction.",
  },
  {
    // The one refusal: both arms are numbers, so no test and no static answer exists.
    name: "Ze/D43: `:of Int` on an `Int | Real` union is REFUSED",
    source: `(fn what [x <- Int | Real] -> String (
  (if (x :of Int) (return "int"))
  (return "real")
))
(console.log (what 5))`,
    expectDiagnostic: /LL0104/,
    wasBroken:
      "answered by `typeof === number`, which is TRUE for both arms -- so the guard was a coin flip " +
      "that always said yes. Undecidable in principle: JS has one number type.",
  },

  // ===============================================================================================
  // Zf / D42 -- interfaces get a SHAPE, and `:implements` stops being an unchecked claim.
  //
  // `visitInterface` never read `node.body`. Every interface in the language was
  // `{kind, name, generics}` and nothing else -- `(definterface Iterable<T> (fn iterator [] ->
  // Iterator<T>))` dropped its methods on the floor.
  //
  // The consequence is the one that matters: there was NO diagnostic for a class that declares an
  // interface it does not satisfy (`methodMappings: new Map() // TODO`). A class could claim
  // `:implements Iterable`, implement nothing, and dispatch would still lower `(x.total)` to
  // `total(x)`. NOMINAL WITHOUT VERIFICATION is the worst cell of the matrix -- the tag costs you the
  // flexibility of structural typing and buys none of its safety, because nothing checks it.
  //
  // D42 (the Go model): types are nominal, interfaces are structural. This is the half that makes the
  // nominal tag MEAN something. Implicit conformance -- a class satisfying an interface it never
  // declared -- is Zg.
  // ===============================================================================================
  {
    name: "Zf/D42: declaring an interface you do not satisfy is refused",
    source: `(definterface Greeter
  (fn greet [] -> String))
(defclass Rude :implements Greeter
  (fn shout [] -> String (return "OI")))
(console.log "declared")`,
    expectDiagnostic: /LL0209/,
    wasBroken:
      "SILENT. `:implements` was an unchecked claim -- the interface had no members to check against, " +
      "so nothing could disagree with it. A class could claim any interface and implement none of it.",
  },
  {
    // The guard, and the thing that proves the check is real rather than always-firing.
    name: "Zf/D42: declaring an interface you DO satisfy is fine",
    source: `(definterface Greeter
  (fn greet [] -> String))
(defclass Polite :implements Greeter
  (fn greet [] -> String (return "hello")))
(let p (Polite))
(console.log (p.greet))`,
    expect: ["hello"],
    wasBroken:
      "NOT broken -- the GUARD. An interface with members is only useful if a class that HAS them " +
      "passes; a check that fires on everything is the vacuous-conformance failure in reverse.",
  },
  {
    // An interface whose method is inherited from a SUPER-interface. `isSubtype` already walks
    // `implementedInterfaces` by name, so conformance walks the same chain rather than pre-flattening
    // members -- which would need the super processed first and reintroduce a declaration-order
    // dependency the symbol table exists to remove.
    name: "Zf/D42: conformance walks the interface's own :implements chain",
    source: `(definterface Named
  (fn name [] -> String))
(definterface Greeter :implements Named
  (fn greet [] -> String))
(defclass Person :implements Greeter
  (fn greet [] -> String (return "hi"))
  (fn name [] -> String (return "sam")))
(let p (Person))
(console.log (p.greet) (p.name))`,
    expect: ["hi sam"],
    wasBroken:
      "NOT broken -- a GUARD. A sub-interface's members are its own PLUS its super's, and a class must " +
      "satisfy both. Walking the chain (rather than flattening at declaration time) is what keeps this " +
      "order-independent.",
  },
  {
    // The one above passes whether or not the chain is walked -- `Person` has BOTH members, so a
    // conformance check that only ever looked at `Greeter`'s own body would still let it through. This
    // is the case that can only pass if the chain is really walked: `Half` satisfies Greeter's OWN
    // member and is missing the one Greeter inherits from Named.
    name: "Zf/D42: a member inherited from a super-interface is still required",
    source: `(definterface Named
  (fn name [] -> String))
(definterface Greeter :implements Named
  (fn greet [] -> String))
(defclass Half :implements Greeter
  (fn greet [] -> String (return "hi")))
(console.log "declared")`,
    expectDiagnostic: /LL0209/,
    wasBroken:
      "SILENT, like every other unchecked `:implements`.",
  },
  {
    // The other direction of the same question: a member the class inherits from its SUPERCLASS
    // satisfies the interface just as well as one it declares itself. A conformance check that reads
    // only a class's OWN members would fire on every subclass that does not redeclare what it already
    // inherits -- a false positive on correct code, which is worse than the silence it replaced.
    name: "Zf/D42: a member inherited from a SUPERCLASS satisfies the interface",
    source: `(definterface Greeter
  (fn greet [] -> String))
(defclass Base
  (fn greet [] -> String (return "hi")))
(defclass Sub :extends Base :implements Greeter)
(let s (Sub))
(console.log (s.greet))`,
    expect: ["hi"],
    wasBroken:
      "NOT broken -- the GUARD against LL0209 over-firing.",
  },

  // Zg / D42 -- structural conformance. The other half of the Go model.
  //
  // Zf made a DECLARED `:implements` mean something. Zg makes the declaration optional: a class
  // satisfies an interface by SHAPE, whether or not it says so. That is the half D5 ("full structural
  // typing") always wanted and P7d never overruled -- they were answering different questions. Classes
  // stay NOMINAL to each other (`Dog` is not a `Cat`, however identical); only INTERFACES are
  // structural.
  // ===============================================================================================
  {
    name: "Zg/D42: a class satisfies an interface by SHAPE, without declaring it",
    source: `(definterface Greeter
  (fn greet [] -> String))
(defclass Casual
  (fn greet [] -> String (return "yo")))
(fn welcome [g <- Greeter] -> String (return (g.greet)))
(let c (Casual))
(console.log (welcome c))`,
    expect: ["yo"],
    wasBroken:
      "A TYPE ERROR. `isAssignable` was nominal for interfaces too, so a class that had every member " +
      "an interface asked for was still refused unless it declared `:implements`. The interface was a " +
      "password, not a shape.",
  },
  {
    // The falsifier that matters. If Zg lands as FULL structural, this flips and classes stop being
    // nominal to each other -- D42's whole ruling. `00_errors.expect` pins the same thing for
    // CustomError/SpecificError.
    name: "Zg/D42: classes stay NOMINAL to each other (Dog is not a Cat)",
    source: `(defclass Dog
  (fn speak [] -> String (return "woof")))
(defclass Cat
  (fn speak [] -> String (return "meow")))
(fn hear [c <- Cat] -> String (return (c.speak)))
(let d (Dog))
(console.log (hear d))`,
    expectDiagnostic: /LL02\d\d/,
    wasBroken:
      "NOT broken -- the GUARD. `Dog` and `Cat` are shape-identical. Structural interfaces must not " +
      "leak into class-to-class assignability.",
  },
  {
    // Width, and the reason it is width and not equality: implementing an interface means having AT
    // LEAST its members.
    name: "Zg/D42: a class MISSING a member does not satisfy the interface",
    source: `(definterface Greeter
  (fn greet [] -> String))
(defclass Mute
  (fn think [] -> String (return "...")))
(fn welcome [g <- Greeter] -> String (return (g.greet)))
(let m (Mute))
(console.log (welcome m))`,
    expectDiagnostic: /LL02\d\d/,
    wasBroken:
      "NOT broken -- the GUARD against conformance going vacuous.",
  },
  {
    // The vacuity trap, ruled. Structurally, an EMPTY interface is satisfied by everything -- `every`
    // over no members is vacuously true -- which would make `[x <- Marker]` accept any object at all
    // while LOOKING like a constraint. Silent, and worse than refusing. So: an empty interface is
    // satisfied by nothing structurally. It is a MARKER, and a marker must be claimed.
    name: "Zg/D42: an EMPTY interface is not satisfied structurally",
    source: `(definterface Marker)
(defclass Anything
  (fn whatever [] -> String (return "x")))
(fn mark [m <- Marker] -> String (return "marked"))
(let a (Anything))
(console.log (mark a))`,
    expectDiagnostic: /LL02\d\d/,
    wasBroken:
      "NOT broken -- the ruling. Vacuous conformance is the failure mode structural typing is famous " +
      "for, and an empty interface is where it starts.",
  },
  {
    // ...and the other half of that ruling: DECLARING the marker still works. Nominal `isSubtype` runs
    // before structural conformance and answers this on its own, which is exactly why refusing the
    // structural case costs nothing -- a marker interface remains usable, it just has to be claimed.
    name: "Zg/D42: an empty interface still works when DECLARED",
    source: `(definterface Marker)
(defclass Tagged :implements Marker
  (fn whatever [] -> String (return "x")))
(fn mark [m <- Marker] -> String (return "marked"))
(let t (Tagged))
(console.log (mark t))`,
    expect: ["marked"],
    wasBroken:
      "NOT broken -- proves the empty-interface refusal above did not break marker interfaces, only " +
      "made them explicit.",
  },

  // Zia -- `type` is ONE NAME DOING TWO JOBS, dispatching on the JS runtime tag of its argument: a
  // string does a by-name registry lookup, anything else reflects the value. So "what is the type of
  // this String VALUE?" is structurally unaskable, and `(type s)` where `s` holds "Money" answers with
  // MONEY's metadata.
  //
  // Not hypothetical: it already produced a silently wrong example pinned by a golden (15_recursion's
  // `Tree sum: 0`, which is 21 -- see Zic). The author's own code expected `type` to reflect.
  //
  // `type` reflects a VALUE. `type-by-name` does the lookup. By-name has to survive because the
  // metadata graph's `extends`/`implements` edges are STRINGS -- drop it and the graph is unwalkable.
  // ===============================================================================================
  {
    name: "Zia: `(type s)` on a String VARIABLE reflects the STRING",
    source: `(defclass Money
  (fn amount [] -> Int (return 5)))
(let s "Money")
(let t (type s))
(console.log t["name"])`,
    expect: ["String"],
    wasBroken:
      "Answered `Money` -- the CLASS's metadata, because the value happened to spell a type's name. " +
      "The overload made a String value's own type unaskable.",
  },
  {
    name: "Zia: `type-by-name` does the lookup `type` used to guess at",
    source: `(defclass Money
  (fn amount [] -> Int (return 5)))
(let t (type-by-name "Money"))
(console.log t["name"] t["kind"])`,
    expect: ["Money class"],
    wasBroken: "Did not exist. The lookup was only reachable by passing a string to `type`.",
  },
  {
    // The author's invariant, asked for during planning. Expected GREEN already -- `type`'s function
    // branch reads `__ll_name` then looks the name up, so a class VALUE and its NAME already agree.
    // Pinned so the Zia split cannot quietly break it.
    name: "Zia: `(type Money)` equals `(type-by-name \"Money\")`",
    source: `(defclass Money
  (fn amount [] -> Int (return 5)))
(let a (type Money))
(let b (type-by-name "Money"))
(console.log (== a["name"] b["name"]) (== a["kind"] b["kind"]))`,
    expect: ["true true"],
    wasBroken:
      "NOT broken -- the INVARIANT. A class is reachable by value or by name and the two must not " +
      "diverge.",
  },
  {
    // Why there is no hard guard on a string literal: this is a legitimate idiom under reflect
    // semantics. "" names no type, so the LL0218 hint must stay silent here.
    name: "Zia: `(type \"\")` is String, and does NOT warn",
    source: `(let t (type ""))
(console.log t["name"])`,
    expect: ["String"],
    mustNotDiagnose: /LL0218/,
    wasBroken:
      "Answered `{name: '', kind: 'unknown'}` -- it looked \"\" up as a type name and found nothing.",
  },
  {
    // The migration hint. Fires ONLY when the literal names something real, which is what keeps it off
    // `(type "")` and `(type "hello")`.
    name: "Zia: `(type \"Money\")` HINTS at type-by-name",
    source: `(defclass Money
  (fn amount [] -> Int (return 5)))
(console.log ((type "Money")["name"]))`,
    expectDiagnostic: /LL0218/,
    wasBroken:
      "SILENT, and it silently CHANGED MEANING in this phase: `(type \"Money\")` was Money's metadata " +
      "and is now String's. A literal that names a known type is the one case where the old meaning " +
      "was probably intended.",
  },
  {
    name: "Zia: `(type \"hello\")` does not warn -- it names nothing",
    source: `(defclass Money
  (fn amount [] -> Int (return 5)))
(let t (type "hello"))
(console.log t["name"])`,
    expect: ["String"],
    mustNotDiagnose: /LL0218/,
    wasBroken: "NOT broken -- the GUARD that keeps the hint from firing on ordinary strings.",
  },

  // Zib / D43 -- reflection on a primitive is a STATIC question, and the six primitives are real types.
  //
  // The table was `getAllClassMetadata()` + `getAllFunctionMetadata()` and nothing else, so the six
  // most common types in the language were not in it. `(type 5)` fell through every arm of the runtime
  // -- there is no number arm -- and answered `{kind:'unknown'}`.
  //
  // It cannot be fixed at run time. Int/Real are one JS number (`5.0 === 5`); Char/String are one JS
  // string (`"c"` is both). `typeof` says "number", never WHICH. The checker knows, so the answer comes
  // from the checker or not at all.
  // ===============================================================================================
  {
    name: "Zib/D43: `(type x)` on an Int answers Int",
    source: `(let x 5)
(let t (type x))
(console.log t["name"] t["kind"])`,
    expect: ["Int primitive"],
    wasBroken: "`{kind:'unknown'}` -- and `t[\"name\"]` threw a D9 KeyError, because that arm had no name.",
  },
  {
    // The case JS cannot answer AT ALL. `5.5` and `5` are one runtime type; only the annotation
    // separates them, which is exactly why this must be decided statically (D43).
    name: "Zib/D43: `(type r)` on a Real answers Real, not Int",
    source: `(let r <- Real 5.5)
(let t (type r))
(console.log t["name"])`,
    expect: ["Real"],
    wasBroken: "`{kind:'unknown'}`. A runtime answer here is impossible: `typeof 5.5` is 'number'.",
  },
  {
    // The three paths to one type must agree, or the API has re-grown the seam Zia removed.
    name: "Zib/D43: `(type \"\")`, `(type String)` and `(type-by-name \"String\")` agree",
    source: `(let a (type ""))
(let b (type String))
(let c (type-by-name "String"))
(console.log (== a["name"] b["name"]) (== b["name"] c["name"]) c["kind"])`,
    expect: ["true true primitive"],
    wasBroken:
      "Three different answers. `(type \"\")` looked \"\" up as a type NAME and found nothing; " +
      "`(type String)` reflected the JS global and reported kind 'class'; `type-by-name` did not exist.",
  },
  {
    // The gradual concession, asserted so it is DOCUMENTED behaviour rather than an accident. Ze took
    // the same one: "a condition we could not type is not a condition we can call wrong."
    name: "Zib/D43: an un-inferred primitive answers Unknown -- it does not GUESS",
    source: `(fn f [x] -> Void (
  (let t (type x))
  (console.log t["name"])))
(f 5)`,
    expect: ["Unknown"],
    wasBroken:
      "NOT broken -- the CONCESSION. `x` is un-annotated, so the channel is empty and the runtime " +
      "cannot finish the job. `Number.isInteger` would answer 'Int' for 5.0 -- a guess that " +
      "CONTRADICTS the static type. Two answers to one question is the bug class this audit kills.",
  },
  {
    // The fold replaces a CALL with a lookup, so the operand stops being evaluated unless we keep it.
    name: "Zib/D43: the folded operand is still evaluated",
    source: `(mut count <- Int 0)
(fn bump [] -> Int (
  (count := (+ count 1))
  (return count)))
(let t (type (bump)))
(console.log t["name"] count)`,
    expect: ["Int 1"],
    wasBroken:
      "NOT broken -- the GUARD. `(type (bump))` folds to a metadata lookup; without the sequence the " +
      "call vanishes and `bump` never runs. Ze's `visitTypeGuard` carries the same sequence.",
  },

  // Zl/member-index -- a dotted `.member` after an index went through `__ll_index`, the CHECKED
  // container read, which demands an integer-in-bounds key on an array/string. So `xs[0].length` asked
  // `__ll_index("hi", "length")` and threw RangeError. The `members` flag (ast.ts) exists to keep
  // `.name` distinct from `["name"]` -- visitIndexer just discarded it. A `.member` suffix is an
  // UNCHECKED member read, exactly like `obj.member` (which already lowers to `__ll_member`).
  // ===============================================================================================
  {
    name: "Zl/member-index: a native member after an index reads, not throws",
    source: `(let ws ["hi" "there"])
(console.log ws[0].length)`,
    expect: ["2"],
    wasBroken:
      "RangeError: `xs[0].length` lowered to `__ll_index(__ll_index(xs,0), \"length\")`, and the outer " +
      "__ll_index rejects a non-integer key on a string. Every native member on an indexed element threw.",
  },
  {
    // The guard for the ONE behavior change: an absent object field via `.member` returns nil (like
    // `obj.absentField`) rather than throwing KeyError. That makes it AGREE with `obj.member`, not a
    // guarantee lost -- while a bracket `["key"]` suffix stays on the checked __ll_index path.
    name: "Zl/member-index: a bracket suffix stays checked (throws on absent key)",
    source: `(let m {:a 1})
(console.log m["b"])`,
    expectThrow: /KeyError/,
    wasBroken:
      "NOT broken -- the GUARD. `[\"b\"]` is a bracket index, not a `.member`, so it stays on " +
      "__ll_index and still throws KeyError on an absent map key (D9f). Only `.member` goes unchecked.",
  },

  // PR1 (games) -- a comment placed before a clause (a `cond` case, a `match` arm, a `for` clause)
  // threw a RAW parse error. Comments are real tokens (l-lang keeps them as AST nodes), so a clause
  // loop that consumed only clauses met the comment as an unexpected token. Now each clause loop
  // consumes leading comments, so a clause may be documented.
  // ===============================================================================================
  {
    name: "PR1: comments between cond/match/for clauses parse",
    source: `(fn classify [n <- Int] -> String (
  (cond
    ((> n 0) (return "pos"))
    ;; the default
    (:else (return "neg")))))
(fn name-of [n <- Int] -> String (
  (match n {
    1 => "one"
    ;; fallback arm
    _ => "many"})))
(mut sum 0)
(for :each x
  ;; iterate
  :from [1 2 3] :then (sum := (+ sum x)))
(console.log (classify 5) (name-of 1) sum)`,
    expect: ["pos one 6"],
    wasBroken:
      "each threw `Expecting RParen/RBrace but found ';; ...'`: the clause loops (condExpr, matchExpr, " +
      "forExpr) consumed only clauses, so a documenting comment before a clause was an unexpected token.",
  },

  // CP3 (games) -- `deep-copy`, an OPT-IN deep copy. The default struct copy is shallow-at-reference
  // (C#-style, goldened): a struct's array field stays SHARED, so `(let snap world)` gives a
  // half-working undo. `deep-copy` recurses arrays and nested structs.
  // ===============================================================================================
  {
    name: "CP3: `deep-copy` snapshots a struct's arrays independently",
    source: `(defstruct World (mut :ctor boxes <- Int[]))
(let w (World [1 2 3]))
(let snap (deep-copy w))
(w.boxes[0] := 99)
(console.log snap.boxes[0] w.boxes[0])`,
    expect: ["1 99"],
    wasBroken:
      "the shallow default shares the array -- `(let snap w)` then mutating `w.boxes[0]` changed " +
      "`snap.boxes[0]` too. `deep-copy`'s snapshot is independent (1), the original still mutates (99).",
  },
  {
    // Contrast guard: the DEFAULT copy is deliberately shallow-at-reference and stays that way.
    name: "CP3: the default `(let snap w)` still shares the array (GUARD)",
    source: `(defstruct World (mut :ctor boxes <- Int[]))
(let w (World [1 2 3]))
(let snap w)
(w.boxes[0] := 99)
(console.log snap.boxes[0])`,
    expect: ["99"],
    wasBroken:
      "NOT broken -- the ruled default. Shallow-at-reference is goldened (C# value-type semantics); " +
      "`deep-copy` is the opt-in, it does not change the default.",
  },

  // CF2 (games) -- a one-armed `if`/`when` as the THEN branch of an `if`/`cond` clause dangles the
  // outer `else`. `visitIf`/`visitCond` pass an else-less inner `IfStatement` as the consequent
  // UNWRAPPED, and astring's dangling-else then binds the outer `else` to the INNER `if`. Killed
  // tetris's spacebar; recurred in minesweeper. Assert BEHAVIOUR (which branch ran), not emitted JS --
  // FINDINGS.md's warning: the JS is exactly what is wrong.
  // ===============================================================================================
  {
    name: "CF2: a one-armed inner `if` does not steal the outer `else`",
    source: `(let k "a")
(mut out <- String "none")
(if (== k "a") (if false (out := "A")) (out := "elsebranch"))
(console.log out)`,
    expect: ["none"],
    wasBroken:
      "printed `elsebranch`: the outer `else` bound to the inner `if false` (dangling-else), so a true " +
      "outer test with a false inner test ran the outer's else. The inner `if` has no else.",
  },
  {
    name: "CF2: a `cond` clause whose body is a one-armed `if` fires correctly",
    source: `(let k "b")
(mut out <- String "none")
(cond
  ((== k "a") (if false (out := "A")))
  ((== k "b") (out := "B"))
  (:else (out := "default")))
(console.log out)`,
    expect: ["B"],
    wasBroken:
      "printed `default` (or `none`): the `a`-clause's one-armed `if` left a dangling `else`, which " +
      "swallowed the `b`-clause and the `:else` into the wrong branch. tetris's spacebar bug exactly.",
  },

  // CF3 (games) -- a `match` arm whose body is a bare `if` silently no-ops and the match falls
  // through. `visitMatch`'s LOCAL `ensureReturns` injected a trailing `return` for an ExpressionStatement
  // or BlockStatement tail but fell through on an `IfStatement`, so the arm's `if` ran as a
  // side-effect-free no-op. The shared `withTrailingReturn` already recurses into an `IfStatement`'s
  // arms -- the two diverged. Rendered wrong glyphs in minesweeper.
  // ===============================================================================================
  {
    name: "CF3: a `match` arm whose body is a bare `if` fires",
    source: `(fn pick [n <- Int flag <- Boolean] -> String (
  (match n {
    1 => (if flag "yes" "no")
    2 => "two"
  })))
(console.log (pick 1 false))`,
    expect: ["no"],
    wasBroken:
      "printed nothing (nil): the arm-1 `if` produced no `return`, so the arm no-op'd and the match " +
      "fell through past `2` to the final nil. minesweeper's wrong-glyph bug.",
  },

  // Zl/interface-contextual-typing -- an UNANNOTATED class method inherits its interface's declared
  // RETURN type (D42). `Circle.area` had no `-> ...`, so it typed as `Any` even though the class
  // `:implements Shape` and Shape declares `(fn area [] -> Real)` -- the same method reflecting `Any`
  // on the concrete class but `Real` through the interface. Now propagated: return-type only,
  // directly-declared `:implements` only. Reflection (and the class's declared shape) honour it.
  // ===============================================================================================
  {
    name: "Zl: an unannotated method inherits its interface's return type",
    source: `(definterface Shape
  (fn area [] -> Real))
(defclass Circle :implements Shape
  (mut :ctor radius <- Real)
  (fn area [] (return (* 3.14 (* this.radius this.radius)))))
(let c (Circle 2.0))
(let t (type c))
(let ms t["methods"])
(let m0 ms[0])
(console.log m0["returns"])`,
    expect: ["Real"],
    wasBroken:
      "`Any` -- an unannotated method dropped to Any, ignoring the `-> Real` the author DID write, on " +
      "the interface. Propagation is annotation-carrying, not inference: only an unannotated return " +
      "is filled, a real annotation is never overridden.",
  },
  {
    // The guard: a method the class annotates ITSELF keeps its own return; the interface does not
    // override it. (And a class with no interface is unaffected.)
    name: "Zl: a method's OWN return annotation is not overridden by the interface",
    source: `(definterface Shape
  (fn area [] -> Real))
(defclass Sq :implements Shape
  (fn area [] -> Int (return 4)))
(let s (Sq))
(let t (type s))
(let ms t["methods"])
(let m0 ms[0])
(console.log m0["returns"])`,
    expect: ["Int"],
    wasBroken:
      "NOT broken -- the GUARD. `Sq.area` declares `-> Int`; propagation fills only an UNANNOTATED " +
      "return, so the class's own annotation wins (whether or not it matches the interface -- that " +
      "is D42/Zf's conformance question, checked separately).",
  },

  // Zja -- INTERFACES were not in `__ll_type_metadata` at all, blocked by two independent gates:
  // `visitInterface` built no `codegenMetadata`, AND the getter filtered `kind in {class,struct}`.
  //
  // The damage is a DANGLING POINTER in the table's own graph: `(type r)` reports
  // `implements: ["Shape"]`, and `Shape` cannot then be looked up. Zf gave interfaces a shape, so the
  // data exists; nothing carried it to codegen.
  // ===============================================================================================
  {
    name: "Zja: an interface is IN the metadata table",
    source: `(definterface Shape
  (fn area [] -> Int))
(let s (type-by-name "Shape"))
(let ms s["methods"])
(let m0 ms[0])
(console.log s["name"] s["kind"] m0["name"])`,
    expect: ["Shape interface area"],
    wasBroken:
      "`{kind:'unknown'}`. Every interface in the language was absent from the table -- zero hits for " +
      "`\"kind\": \"interface\"` across every golden, including the interface examples.",
  },
  {
    // The one that shows what the absence COST. The table's graph edges are names, so an edge that
    // does not resolve is a pointer into nothing.
    name: "Zja: the `implements` edge RESOLVES",
    source: `(definterface Shape
  (fn area [] -> Int))
(defclass Rect :implements Shape
  (fn area [] -> Int (return 6)))
(let r (Rect))
(let t (type r))
(let ifaces t["implements"])
(let n ifaces[0])
(let s (type-by-name n))
(console.log n s["kind"])`,
    expect: ["Shape interface"],
    wasBroken:
      "`Shape unknown` -- the table pointed at a type it did not contain. Walking from a type to the " +
      "interface it implements is the whole reason `type-by-name` exists.",
  },

  // Zjb -- the table carried NINE of the host's globals, in every program ever compiled. `std/js` is
  // the PRELUDE, so its `(fn :extern ...)` declarations were in every table, each rendering
  // `{returns:'Any', paramsList:[{name:'args',type:'Any'}]}`.
  //
  // An extern is the HOST's, not l-lang's -- the line this codebase already takes twice, via the same
  // `entry.value.extern` seam: "an ambient global is the host's, not ours to order".
  // ===============================================================================================
  {
    name: "Zjb: a host `:extern` is NOT in the table",
    source: `(let p (type-by-name "parseInt"))
(console.log p["kind"])`,
    expect: ["unknown"],
    wasBroken:
      "`function` -- with `returns: 'Any'`. parseInt, parseFloat, isNaN, isFinite, setTimeout, " +
      "setInterval, clearTimeout, clearInterval and fetch were in EVERY table, all nine, always.",
  },
  {
    // The guard, and the one that matters: filter the host, not the user. `02_fn_types` reflects on
    // its own functions by name and would catch this as a golden move.
    name: "Zjb: a USER function is still in the table",
    source: `(fn my-fn [x <- Int] -> Int (return x))
(let f (type-by-name "my-fn"))
(console.log f["name"] f["kind"] f["returns"])`,
    expect: ["my-fn function Int"],
    wasBroken: "NOT broken -- the GUARD against the extern filter eating user code.",
  },

  // Zjc -- TWO RENDERERS, TWO ANSWERS. A class method returning `Int[]` rendered "Array"; a top-level
  // function returning `Int[]` rendered "Int[]". The class path read `.name || 'Any'` -- and an array
  // type's `.name` is the bare string "Array", which drops the element type -- while the function path
  // already used `TypeChecker.formatType`, which renders it properly.
  //
  // Same question, two answers, decided by which KIND of thing you asked about. That is the shape this
  // audit exists to kill, and the table is where it was hiding in plain sight.
  // ===============================================================================================
  {
    name: "Zjc: a class method returning `Int[]` says so",
    source: `(defclass Bag
  (fn items [] -> Int[] (return [1 2 3])))
(let t (type-by-name "Bag"))
(let ms t["methods"])
(let m0 ms[0])
(console.log m0["returns"])`,
    expect: ["Int[]"],
    wasBroken:
      "`Array` -- the element type dropped. The same method written as a top-level function reported " +
      "`Int[]` correctly, because the two paths never shared a renderer.",
  },
  {
    // The two paths, asked the same question side by side. This is the assertion the split could not
    // survive: it compares them directly rather than trusting either alone.
    name: "Zjc: a class method and a free function AGREE about `Int[]`",
    source: `(defclass Bag
  (fn items [] -> Int[] (return [1 2 3])))
(fn free-items [] -> Int[] (return [1 2 3]))
(let bag (type-by-name "Bag"))
(let ms bag["methods"])
(let m0 ms[0])
(let free (type-by-name "free-items"))
(console.log (== m0["returns"] free["returns"]))`,
    expect: ["true"],
    wasBroken: "`false`: the class said `Array`, the function said `Int[]`. One type, two renderings.",
  },
  {
    // One key. The class path said `params`, the function path said `paramsList` -- for the same
    // concept, in the same table, read by the same consumer.
    name: "Zjc: both paths spell the parameter list `params`",
    source: `(defclass Bag
  (fn put [x <- Int] -> Int (return x)))
(fn free-put [x <- Int] -> Int (return x))
(let bag (type-by-name "Bag"))
(let ms bag["methods"])
(let m0 ms[0])
(let mp m0["params"])
(let p0 mp[0])
(let free (type-by-name "free-put"))
(let fp free["params"])
(let f0 fp[0])
(console.log p0["name"] f0["name"])`,
    expect: ["x x"],
    wasBroken:
      "A free function's parameters were under `paramsList`; a class method's under `params`. Reading " +
      "the table meant knowing which kind you had first.",
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

    if (c.mustNotDiagnose) {
      const hit = diagnostics.find((d) => c.mustNotDiagnose!.test(d));
      if (hit) {
        return { ok: false, detail: `must NOT report ${c.mustNotDiagnose}, but got: ${hit.slice(0, 88)}` };
      }
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

  // CHILD_ENV, not process.env -- FORCE_COLOR makes node colourise console.log through a pipe, so
  // `expect: ["7 9"]` receives escape codes and every numeric case fails. See childEnv.ts.
  const proc = spawnSync("node", [jsPath], {
    encoding: "utf-8",
    timeout: RUN_TIMEOUT_MS,
    env: CHILD_ENV,
  });
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

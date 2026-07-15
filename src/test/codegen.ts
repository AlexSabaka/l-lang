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

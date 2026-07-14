# 🗺️ Roadmap & Status

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler, merging strategic goals with tactical implementation tasks.

**Status Legend:**
*   ✅ Complete
*   ⚠️ Claimed complete, and is not — see the note
*   🚧 In Progress
*   🔮 Future Thinking

> **A note on ⚠️ — "written, and never wired in."**
>
> Several boxes below were ticked because the *code was written*. It was then never **called**. This
> is not an occasional slip; it is **this compiler's signature failure mode**, and by the end of Phase
> S and Phase 5 it had been found **nine** times:
>
> | # | what | how it surfaced |
> |---|---|---|
> | 1 | the **desugarer** — never called, *and wrong* (it dropped the middle stage of a 3-stage pipeline) | Phase 3 |
> | 2 | two **runtime matchers** — emitted into every program, called by nothing, unreachable by construction | Phase 3 |
> | 3 | the **type channel** — `typeEnv` was a memo cache popped with its scope; nothing was behind the door | Phase 3 |
> | 4 | **`InlineImportsAstVisitor`** — the one pass that honours `export`, commented out. So `(export …)` was decorative | Sa |
> | 5 | **`visitTypeName`** — an annotation door that could never be dispatched (both type passes disable the walk) | Sb |
> | 6 | **`LL0004 ImportHasSymbols`** — dead, *and* it encoded a false invariant, *and* it was frontend-divergent | Sc |
> | 7 | **`:extern`** — parsed by both frontends, honoured by nobody, and **its own rule forbade the only correct way to write it** | Sd |
> | 8 | **`isRuntimeFunction`** — zero callers, always; a worklist marker for a migration that turns out to be blocked | Se |
> | 9 | **`FunctionNode.generics`** — declared, with a comment reading *"NEVER populated by either frontend"*, while every downstream binder already handled it | P5 |
>
> The lesson is a question. Of a claimed feature, do not ask *"is it implemented?"* — ask
> **"who calls it?"** Every one of these had a green tree and a ticked box.
>
> They are marked honestly rather than un-ticked, because *the shape of the mistake is the useful
> part*: a checkbox tracks whether a thing was **built**, not whether it is **load-bearing**.
>
> The evidence for every ⚠️ is in **`docs/spec/DECISIONS.md`**, which is the real status document.

---

## ⚠️ Phase 1: Stabilization & Architecture Fixes (v0.2.0)
**Theme:** "Stop the bleeding."

Focused on technical debt, specifically in code generation and symbol resolution.

- [x] **Codegen Refactor** — ESTree + `astring`. Real, and the foundation everything since sits on.
- [x] **Dependency Management** — `ModuleCache`, cycle handling, `SymbolTable.join`.
- [x] ~~**Two-Pass Symbol Resolution:** proper lexical scoping, forward references, O(1) lookup~~
      ⚠️ **The scope TREE was built. Nothing could read it.**
      `SymbolTable.scopes` was a flat list of module *roots*, and every resolution path walked
      *upward* — so a parameter or a local `let` was written into a child scope and was then
      unfindable. The type system asked that flat question for its entire life. Fixed in **P6**; and
      codegen's own order-dependence — the *other* half of this box — is closed by **D24/Fa**.

## ✅ Phase 2: Syntax Harmonization & OOP (v0.3.0)
**Theme:** "Make it feel like Lisp, work like C#."

- [x] Attributes as S-expressions; `js'()` escape hatch removed; legacy visitors deleted
- [x] Class inheritance, `super()`, interface checks, generic classes/interfaces, RTTI
- [x] Map and indexer type inference
- [x] Operator overloading — registry, dynamic dispatch (and see **W** for what it took to make an
      *imported* operator work)
- [x] `defmodifier` metaprogramming

## ✅ Phase 2.5: Compiler Architecture Refactor (v0.3.5) — *completed retroactively by Phase 3*
**Theme:** "Separate concerns, simplify generation."

Moving from "analysis + codegen" to "analysis + desugaring + codegen".

- [x] **Directory restructuring** by phase (`frontend`, `analysis`, `transformation`, `codegen`, …)
- [x] **`ClassBuilder`** extracted, emits ESTree
- [x] **DesugarAstVisitor:** pipeline (`|>`) and implicit-return logic — **WIRED IN**, at last, in
      Phase 3. It had been ticked complete and never called; codegen desugared pipelines itself and the
      type checker never saw the rewrite. It was also *wrong* — its pipeline transform dropped the
      middle stage of any three-stage pipeline. Codegen's was the reference implementation, and it is
      the one that moved.
- [x] **Runtime helpers** — `__ll_match_list` / `__ll_match_struct` **deleted**. Emitted into every
      program, called by nothing, and unreachable by construction. `__ll_is_type` stays; it is live.

---

## ✅ The stabilization audit (v0.3.6) — the work the roadmap did not have a box for

A full compiler audit produced 16 language rulings (**D1–D16**) and a stabilization backlog. Landing
them is most of the work done since, and none of it appears above. `docs/spec/DECISIONS.md` is the
register; the short version:

- **D3** metaprogramming — `defmodifier`, `:comptime` (a real partial evaluator), `defmacro`/`quote`
- **D9** *what is `nil`* — one bottom value; `T?` optionals with a **forced unwrap** (`LL0205`) and
  flow narrowing; a **partial** indexer vs a **total** `get`
- **D11** the class surface — `:private` enforced and erased; `:static` made real; `defstruct` given
  a class surface; **by-copy value semantics** for structs
- **D12/D13/D16** control forms, map keys, destructuring
- **P4/P5/P7/P8** — the type checker learned to say *no* (`LL0200`–`LL0214`); codegen's wrong
  JavaScript; generics stopped being a lie (variance, `LL0214`); the papercut sweep
- **W** — four silent wrong answers, and the ruling that **an operator is language, not library**
- **P6** — the checker could not see a **local variable**. Reads, writes, `this`, and cross-module
  symbols were all blind. Its scorecard is the phase's real lesson: the 16 diagnostics filed as
  *"false positives blocked on P6"* turned out to be **sixteen real bugs**.

**Where the tree stands** (measured, both frontends): **71 pass / 0 fail / 0 error** (91 total) ·
codegen **103/103** · imports **10/10** · repl **24/24** · smoke **11/11** · **0** corpus type
diagnostics on passing tests · **0** lexical misses · 3 gates `pending`, each tracked to the phase
that owes it.

---

## ✅ Phase 3: One Tree, One Truth (v0.3.7)
**Theme:** "The two halves of the compiler must read the same program."

*   [x] **`DesugarAstVisitor` is wired in.** One desugared tree, read by the type checker *and*
        codegen. Codegen's duplicate pipeline transform and implicit-return injection are deleted.
*   [x] **The types → codegen channel is open.** An identity-keyed `Map<ASTNode, InferredType>` that
        outlives the pass. `typeEnv` was a memo cache popped with its scope — there was nothing behind
        the door to open, so the channel had to be built.
*   [x] **The dead runtime matchers are deleted.**

**The headline:** an **implicit return was enforced by nobody**. `(fn f [] -> Int "str")` compiled
clean, because codegen added the return and the checker never saw it. It is checked now.

**Also fixed on the way:** a `:comptime` fold inside an `if` emitted a `ReferenceError` with zero
diagnostics (the comptime pass never recursed into an `if` body, and the tree-shaker then deleted the
function it failed to fold). **D17**: `(x |> (.m a))` is a method call. **D18**: a trailing `if` yields
a value.

## 🚧 Phase 4 / Phase S: Stdlib (D7) (v0.4.0)
**Theme:** "Hide the JS."

**The stdlib already exists three times, and the three do not agree.** The full inventory, the
rulings (**D19–D22**) and the worklist are in **`docs/spec/STDLIB.md`** — that document is what this
phase executes against.

1.  **`RuntimeProvider.SYMBOL_MAP`** — 12 functions injected into every program *as text*.
    Not importable, not typed. `eval` is literally the empty string.
2.  **`InferTypesAstVisitor.JS_GLOBALS`** — a 30-name allowlist in the *type checker* that waves raw
    JS through **untyped**. Not a stdlib: **a hole in the type system**. `console.log` goes through
    it **579 times**.
3.  **`examples/20-stdlib/std/*.lisp`** — 6 real modules, **compiled and never executed**. Its
    driver calls `length`, `first`, `last`, `at` — four functions that exist nowhere. It was written
    against a stdlib nobody built.

**And the module boundary is fake:** `(export …)` is decorative. `SymbolEntry.exportName` is
written in one place and **read by nobody**; the visibility gate conflates *top-level* with
*exported*; and `InlineImportsAstVisitor` — the one pass that honours the export list — **is
commented out**. (That is the *fourth* "written and never wired in" in this compiler.) Measured
blast radius of enforcing it: **9 references in 2 files**, all of them the stdlib leaking into
itself. Enforcing the boundary costs **one export list**.

*   [x] **Sa — the standard.** `docs/spec/STDLIB.md`; D19–D22; RED gates for every finding.
*   [x] **Sb — `export` means something** (**LL0215**). The module boundary exists. `exportName` has
        a reader. An **operator is exempt** (W: language, not library). Cost, as predicted: **one
        export list**. Two doors bypassed the obvious check — `new`, and *a call head that resolves* —
        and the proof of enforcement was a live golden test going red before the export list was
        fixed.
*   [x] **Sc — the import side.** `ModuleResolver`: `(import "std/math")` resolves **by name**. A
        missing import — and a **namespace** import, which used to log an error and *succeed anyway* —
        is now **LL0217**. A selective import binds only what it names (**LL0216**). The stdlib moved
        to **`lib/std/`**. Found on the way: PEG silently **misparsed** `(import { starts-with } … )`
        into four namespace imports, and `LL0004` was a dead rule encoding a false invariant.
*   [x] **Sd — ambient globals are declarable; `JS_GLOBALS` is dead.** `:extern` works (it had been
        *unusable* — LL0013 rejected every correct one). The 37-name allowlist inside the type checker
        is now `lib/std/js.lisp`, an implicitly-imported prelude. **p5js: 104 → 0**, uncovering two
        guaranteed runtime crashes. A 3-name residual remains, named as a language defect: types and
        values share one namespace.
*   [x] **Se — the dead half of `SYMBOL_MAP` is deleted; the live half CANNOT leave.**
        `get`/`head`/`elem` are the language's only `T?` producers and their type is **inexpressible**
        until call-site generic inference exists (**Phase 5**) — and the mechanism *self-disables* the
        moment the name resolves, so even declaring them would silently delete every optional check.
        The gate marks the day `std/core` becomes possible.
*   [x] **Sf — THE STDLIB RUNS.** D22's layout; `length`/`first`/`last`/`at` exist; `test_stdlib` has a
        golden and executes in **both frontends**. Running it found **three real bugs** immediately —
        `(pow 2 3)` was `NaN` because an inlined function's *parameter* was replaced by a same-named
        top-level symbol.

Deferred, and *not* stdlib modules: **`eval`** (needs a runtime AST interpreter — a phase of its
own) and **quasiquote/unquote** (do not exist).

## ✅ Phase 5: Advanced Type System (v0.5.0) — CLOSED
**Theme:** "Type Safety First."

**The type system stopped lying.** That was the theme, and it is met.

*   [x] ~~Variance checking (`:out`/`:in`)~~ — **done** in P7 (`LL0214`)
*   [x] ~~Static class members~~ — **done** in D11
*   [x] **Generic inference** — `(let b (Box 42))` deduces `Box<Int>`; `(my-head [1 2 3])` solves
        `T = Int` and returns `Int?`; `(Box (Dog))` is refused where a `Box<Animal>` is wanted, with no
        annotation in sight. The **erasure rule** — *every `T` passes, in both directions, always*,
        which was the whole of l-lang's generics — is **deleted**, with zero corpus diagnostics.
        Constructor arguments are checked **at all**, for the first time. **Unblocks `std/core`** (Se).

        The root cause was upstream of the type system: **a generic function could not be written.**
        grammar_v2 had no generics slot; PEG lexed `my-head<T>` as a *single identifier* and produced a
        function nobody could call. `FunctionNode.generics` had been declared the whole time, with a
        comment reading *"NEVER populated by either frontend"*.

### Carried forward — named, not absorbed

Two items were in this phase's list and are **not done**. They are not ticked, and they are not
quietly dropped:

*   ⚠️ **Generic constraints are a BUG, not a missing feature.** `:where T :of Comparable` does not
    parse in grammar_v2 **at all**; in PEG it *parses and is then silently discarded* by two
    independent bugs — an array spread into an object, and a read of a field nothing sets. `:of` is not
    even a constraint keyword (the set is `implements | inherits | is | has`).
    `TypeParameter.constraints` is the empty slot waiting. **A frontend divergence with a silent
    wrong answer**, which puts it in the same family as everything Phase S kept finding.
*   **Abstract classes** — `:abstract` is not a modifier (`LL0015`). Additive; belongs with the class
    surface (D11), not with the type system.

## 🧠 Phase 6: The Brain Transplant (v0.6.0)
**Theme:** "Prepare for the metal."

*   [ ] **HIR:** a *typed, desugared* tree — **unblocked by Phase 3**, which built both halves: there
        is a desugared tree now, and a per-node type channel to type it with
*   [ ] **Lowering:** AST → HIR
*   [ ] **IR Codegen:** refactor JS codegen to consume HIR

## 🚀 Phase 7: The Speed of Light (v1.0.0)
**Theme:** "The Sloth becomes a Cheetah."

*   [ ] LLVM IR codegen visitor
*   [ ] Strict memory layout
*   [ ] Native standard library

---

## Known gaps

Live, reproduced, and deliberately not yet fixed. Full evidence in `docs/spec/DECISIONS.md`.

*   **`__ll_member` is a thermometer.** Where the checker cannot type a receiver, `(obj.m)` is dispatched
    at run time rather than guessed (D1, amended by Xe). It is correct, and it is also a **measurement**:
    every site that reaches it is a receiver the type checker failed to infer. Today that is ~50 sites,
    including `v3.x`, `user.age` and `final-account.balance` — plain struct fields. Each one the checker
    learns to type stops reaching the shim and goes back to a direct `.x` / `.m()`. Watching that number
    fall is the cheapest available measure of the "does not infer every expression" gap.

*   ~~**The checker silently stops walking a block nested in a block**~~ — **FIXED (Xf).**
    `visitStatement`'s final branch is commented *"a wrapped special form — if / for / while / match"*
    and does `this.visit(head)`: it visits the FIRST item and returns. A genuine multi-item **block**
    landed in the same branch, so everything after its first item was dropped — never typed, never
    resolved, never seen by any rule. Put the bad call first and it reported, because then it happened
    to BE the head: the signature of a check that is **not running**, rather than one that is wrong.
    `classifyList` (D25/Xd) is what made a `grouping` separable from a `block` at all.

    **The corpus does not contain this shape — measured, 0 occurrences — and that is exactly why it
    survived.** Unexercised is not the same as dead. The gate is the only thing holding it.
*   **LL0220 can only fire where the head's type is KNOWN.** By design (never report on an `Unknown`),
    so `((get-fn) 2)` is caught when `get-fn`'s return type is *inferred* as a function and NOT when it
    is declared `-> Any`. Both halves are gated. This gets strictly better as return-type inference does.

*   **Expression vs statement.** `(console.log (when false 1))` and `((D).hi)` emit **invalid
    JavaScript** (`LL0101`). One shared root: `isExpressionContext()` asks *"is a `variable` or `match`
    scope anywhere above me on the stack"* — a **positional** property answered by an **ambient-state**
    query, so the identical `if` node compiles two ways depending on what encloses it. The same disease
    Phase F cured in the call decision. **Ruled: D25. Phase X in flight; gates are RED.** (A trailing
    `if` no longer loses its value — that is **D18**.)
*   **The type checker does not infer every expression.** 114 `list` nodes have no entry in the type
    channel, which caps what codegen can prove and is why the struct-copy elision came in at 138
    rather than the 353 predicted.
*   **The call-vs-block rule is implemented three times** — codegen, the checker, and the desugarer —
    and all three guess it from the same proxy, `head._type === "simple-identifier"`. That proxy is why
    an applied lambda cannot be written. **Ruled: D25.**
*   **`03_matching.lisp`'s golden asserts a bug.** `(< _ 0)` — a guard-shaped list pattern — parses as
    a 3-element array *destructure* and falls through to `_`; the golden bakes in
    `how da fck are you still alive?`. A **passing test that asserts the wrong answer**. Its `_3c`
    (encoded `<`) is also emitted as an implicit global.
*   **Pattern matching is half-built.** `:is` is not a grammar rule at all (the keyword is `:of`), and
    `type-pattern`, `rest-pattern` and `functional-pattern` all compile to literal `false`.
*   **`((fn [x] …) 21)` does not compile** (`LL0101`). *Corrected on measurement:* it **parses fine** —
    the grammar was never the problem. Its head is a **lambda**, and codegen's call test is "is the head
    an identifier", so it falls into the implicit-block path and emits statements into an expression
    slot. **Ruled a call: D25.**
*   ~~**`(call f a b)` is the tenth "written and never wired in"**~~ — **FIXED (Xc), and the original
    claim was wrong.** `call` was not missing; it was a runtime shim `(f, args) => Array.isArray(args)
    ? f(...args) : f()`, whose second parameter is an argument ARRAY — so `(call g 2)` **silently drops
    the argument** and returns `NaN`. `(call f a b)` is now desugared to the `CallNode` that codegen
    could always emit and no source syntax ever built.
*   **Missing diagnostics.** Assigning to a `let` (a *constant*) is not checked. `(new)` with no class
    name emits a bottom value. `LL0212` is a syntactic hack that can now be done properly. (`LL0211`
    *does* know required-vs-total arity now — a defaulted `:ctor` member is optional, and an inherited
    one counts. `fn` parameter defaults still do not exist.)
*   **`visitExport` throws instead of diagnosing.** An export list naming an undefined symbol crashes
    the compiler with a Node stack trace, not an `LLxxxx`. And **re-exporting an imported symbol is not
    supported** — which may well be right, but it is unstated.
*   **A second erasure hole.** `typeArgumentsAssignable` returns `true` when *either* side has no type
    arguments, so a bare `Producer` still satisfies a `Producer<Animal>`. Smaller than the rule Phase 5
    deleted, and the same shape.
*   **Nil-check coverage.** The check reads only the **head** of a member chain, and a call head never
    reaches it: `(t.length)` and `c.v.length` are both unchecked.
*   ~~**String escapes are not decoded at all**~~ — **FIXED.** And in both frontends it was the same
    shape: a correct decoder, bypassed on the plain-string path. PEG's `Char` rule decodes every escape
    and has all along — but `RawString` was written `$Char*`, and **`$` yields the raw matched text and
    throws the actions away**. grammar_v2's `formattedString()` called `unescapeString()`; `string()`
    did `.slice(1,-1)`. Which is why an INTERPOLATED string decoded escapes and a plain one did not:
    same escape, two answers, in one language. `unescapeString` was also wrong on `"\\n"` (a chained
    `.replace()` rewrites its own output), so it is now a single pass. No golden moved.
*   **Parse/lex gaps.** Boolean match patterns; `:is` type patterns; the `..` range operator; sized
    array types; `fn` parameter defaults; the numeric tower (octal/binary/hex/fraction/complex all lex,
    none emit). (`__bar` **now lexes** — fixed via `longer_alt`, inbox #1.)
*   **A module boundary is not transitive.** If A imports B and B imports C, A can still name C's
    exports — `SymbolTable.join` splices every module's scopes in, and the import check declines to
    invent a diagnostic where no *direct* import was recorded. Whether a boundary *should* be
    transitive is a real question, and **D20 does not answer it**.
*   **`:as` aliasing is unimplemented.** It parses in both frontends, on both the import and the
    export side, and nothing honours it.
*   **Harness.** `test:type-errors` and `test:imports` are pinned to grammar_v2, so "0 corpus
    diagnostics" is a single-frontend claim. The count also covers only `status: "test"` files —
    `library` and `xfail` are excluded — though that hole is much smaller now: the stdlib **runs**
    (`test_stdlib` has a golden), and `lib/` is walked alongside `examples/`.

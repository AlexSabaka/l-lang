# 🗺️ Roadmap & Status

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler, merging strategic goals with tactical implementation tasks.

**Status Legend:**
*   ✅ Complete
*   ⚠️ Claimed complete, and is not — see the note
*   🚧 In Progress
*   🔮 Future Thinking

> **A note on ⚠️.** Several boxes below were ticked because the *code was written*. It was then never
> *wired in*: the desugarer exists and is never called; two runtime helpers are emitted into every
> program and called by nothing; "proper lexical scoping" was never reachable by the type system.
> Each was found by a later phase tripping over it. They are marked honestly rather than un-ticked,
> because *the shape of the mistake is the useful part* — a checkbox tracks whether a thing was
> built, not whether it is load-bearing.
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
      unfindable. The type system asked that flat question for its entire life. Fixed in **P6**;
      forward references are *still* order-dependent in codegen (see Known Gaps).

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

**Where the tree stands:** 70 pass / 0 fail / 0 error (97 total), both frontends · codegen 89/89 ·
0 corpus type diagnostics · imports 9/9.

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

## 🔮 Phase 5: Advanced Type System (v0.5.0)
**Theme:** "Type Safety First."

*   [x] ~~Variance checking (`:out`/`:in`)~~ — **done** in P7 (`LL0214`)
*   [x] ~~Static class members~~ — **done** in D11
*   [ ] **Generic constraints** — `:where T :of Comparable` does not parse in grammar_v2 at all
*   [ ] **Generic inference** — `(let b (Box 42))` does not deduce `Box<Int>`; it "works" only
        because generics are erased
*   [ ] **Abstract classes** — `:abstract` is not a modifier (`LL0015`)

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

*   **Expression vs statement.** `(console.log (when false 1))` and `((D).hi)` emit **invalid
    JavaScript** (`LL0101`). One shared root: `isExpressionContext()` is true only inside a
    `variable` or `match` scope. (A trailing `if` no longer loses its value — that is **D18**.)
*   **The type checker does not infer every expression.** 114 `list` nodes have no entry in the type
    channel, which caps what codegen can prove and is why the struct-copy elision came in at 138
    rather than the 353 predicted.
*   **The call-vs-block rule is implemented three times** — codegen, the checker, and the desugarer.
*   **`03_matching.lisp`'s golden asserts a bug.** `(< _ 0)` — a guard-shaped list pattern — parses as
    a 3-element array *destructure* and falls through to `_`; the golden bakes in
    `how da fck are you still alive?`. A **passing test that asserts the wrong answer**. Its `_3c`
    (encoded `<`) is also emitted as an implicit global.
*   **Pattern matching is half-built.** `:is` is not a grammar rule at all (the keyword is `:of`), and
    `type-pattern`, `rest-pattern` and `functional-pattern` all compile to literal `false`.
*   **`((fn [x] …) 21)` does not compile** (`LL0101`). The AST can represent it now (the `call` node);
    the grammar cannot parse it.
*   **No ambient-global declaration** — the p5 bindings reference `mouseX`, `frameCount` and friends,
    which the language has no way to declare.
*   **Codegen is source-order dependent.** A class used *before* its declaration emits a reference to
    the class object instead of constructing (`(Dog)` → `__ll_copy(Dog)`). Silent.
*   **Missing diagnostics.** Assigning to a `let` (a *constant*) is not checked. `(new)` with no class
    name emits a bottom value. `LL0212` is a syntactic hack that can now be done properly. `LL0211`
    does not know required-vs-total arity.
*   **Nil-check coverage.** The check reads only the **head** of a member chain, and a call head never
    reaches it: `(t.length)` and `c.v.length` are both unchecked.
*   **Parse/lex gaps.** `__bar` does not lex; boolean match patterns; `\"` is not unescaped inside a
    string; `:is` type patterns; the `..` range operator; sized array types; `fn` parameter defaults;
    the numeric tower (octal/binary/hex/fraction/complex all lex, none emit).
*   **A module boundary is not transitive.** If A imports B and B imports C, A can still name C's
    exports — `SymbolTable.join` splices every module's scopes in, and the import check declines to
    invent a diagnostic where no *direct* import was recorded. Whether a boundary *should* be
    transitive is a real question, and **D20 does not answer it**.
*   **`:as` aliasing is unimplemented.** It parses in both frontends, on both the import and the
    export side, and nothing honours it.
*   **Harness.** `test:type-errors` and `test:imports` are pinned to grammar_v2, so "0 corpus
    diagnostics" is a single-frontend claim. Worse: that count covers **only `status: "test"` files**
    — `library` and `xfail` are excluded *entirely*, so the true corpus total is **115 across 6
    files**, and a `library` file is **compiled but never executed**. The whole `std/` tree is marked
    `library`, which is exactly why a stdlib calling four nonexistent functions sat in the tree,
    green, for the entire audit. A test that is compiled but never run asserts nothing.

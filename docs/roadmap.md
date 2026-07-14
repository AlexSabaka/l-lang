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

## ⚠️ Phase 2.5: Compiler Architecture Refactor (v0.3.5)
**Theme:** "Separate concerns, simplify generation."

Moving from "analysis + codegen" to "analysis + desugaring + codegen".

- [x] **Directory restructuring** by phase (`frontend`, `analysis`, `transformation`, `codegen`, …)
- [x] **`ClassBuilder`** extracted, emits ESTree
- [ ] ~~**DesugarAstVisitor:** move pipeline (`|>`) and implicit-return logic~~
      ⚠️ **THE DESUGARER IS NOT IN THE PIPELINE.** The class exists and the logic really was moved
      into it. It is never called: the "desugar stage" runs TreeShake and Comptime and nothing else,
      and its only instantiation anywhere is *inside* `ComptimeEvaluationAstVisitor`. So **codegen
      still desugars pipelines itself, and the type checker never sees the rewrite** — the two halves
      of the compiler read different programs. Found in P6g, where `(account |> (.apply evt))` read as
      a standalone call to a free function and produced three phantom `LL0211`s.
- [ ] ~~**Runtime helpers:** `match.ts` / `types.ts`~~
      ⚠️ `__ll_match_list` and `__ll_match_struct` are emitted into **every** program and called by
      **zero** code. (`__ll_is_type` was dead too, until W gave it a caller.)

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

## 🚧 Phase 3: One Tree, One Truth (v0.3.7) — NEXT
**Theme:** "The two halves of the compiler must read the same program."

The precondition for everything below it, and it is made of the two ⚠️s above plus one more.

*   [ ] **Wire `DesugarAstVisitor` into the pipeline.** One desugared tree, seen by the type checker
        *and* codegen. Delete codegen's duplicate pipeline handling.
*   [ ] **Open the types → codegen channel.** `typeEnv` is assigned at `Context.ts:358` and never
        read. Codegen therefore has *no* per-node type information: it guesses (`isMethodOnType`), and
        it cannot elide the struct value-copy wraps it currently emits unconditionally.
*   [ ] **Make the dead runtime helpers live, or delete them.**

## 🔮 Phase 4: Stdlib (D7) (v0.4.0)
**Theme:** "Hide the JS."

The `SYMBOL_MAP` split in **W** already drew the boundary and named the worklist: `get`, `head`,
`tail`, `empty`, `elem`, `cons`, `list`, `call`, `eval`, `type`, `set!`, `set?` are *proto-stdlib
functions* masquerading as language builtins. A real stdlib replaces them — and can later bind to a
native `cstd`.

*   [ ] Replace the runtime `SYMBOL_MAP` functions with a real, importable stdlib
*   [ ] `eval` / a runtime AST interpreter — does not exist; `(eval x)` falls through to host JS
*   [ ] Quasiquote / unquote — do not exist

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

*   [ ] **HIR:** a *typed, desugared* tree — **blocked on Phase 3, which is what makes a typed
        desugared tree possible at all**
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
    `variable` or `match` scope. A trailing `if` also loses its implicit return.
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
*   **Harness.** `test:type-errors` and `test:imports` are pinned to grammar_v2, so "0 corpus
    diagnostics" is a single-frontend claim.

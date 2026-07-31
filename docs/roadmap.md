# 🗺️ Roadmap & Status

> "We get there when we get there, but we do it right."

This document outlines the high-level milestones for the `l-lang` compiler, merging strategic goals with tactical implementation tasks.

> **Before reading any phase below: there are two backends, and C is the reference one.** D66
> deprecated the JavaScript backend to a differential-testing oracle; **D86** made C the
> specification where the two disagree. Phases 1 through 6 were written when JavaScript was the only
> target, and they read that way. See **Phase C** for the backend that document does not mention.
>
> **Status lives in the ledgers, not here.** `src/test/manifest.ts` (what every corpus file is),
> `c-status.ts` (what C must pass — an allowlist that grows) and `js-status.ts` (what JS is known to
> fail — a list that shrinks) are read by the suite and cannot get out of step with it. Numbers
> transcribed into this file can, and have.

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

**Where the tree stood at v0.3.6** (measured, both frontends — a dated snapshot, kept because the
phase's argument rests on it): **71 pass / 0 fail / 0 error** (91 total) · codegen **103/103** ·
imports **10/10** · repl **24/24** · smoke **11/11** · **0** corpus type diagnostics on passing
tests · **0** lexical misses · 3 gates `pending`.

> There is only one frontend now (D39), and the corpus is 326 files. **The live numbers are not
> transcribed into this document** — they are in `src/test/manifest.ts`, `c-status.ts` and
> `js-status.ts`, which the suite reads and this file cannot get out of step with.

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
        `get`/`head`/`elem` are the language's only `T?` producers and their type WAS inexpressible until
        call-site generic inference — which **now exists** (Phase 5, P5b-d), so `first`/`last`/`at` are
        declared `<T> … -> T?` (Phase T / Ga) and `std/core` is unblocked. (The builtins still self-
        disable the moment a name resolves, which is why they stay in `SYMBOL_MAP`.)
*   [x] **Sf — THE STDLIB RUNS.** D22's layout; `length`/`first`/`last`/`at` exist; `test_stdlib` has a
        golden and executes in **both frontends**. Running it found **three real bugs** immediately —
        `(pow 2 3)` was `NaN` because an inlined function's *parameter* was replaced by a same-named
        top-level symbol.

*   [ ] **Sg — retire what remains; close D7.** The one box that keeps this phase 🚧, and it had no
        box at all. `RuntimeProvider.SYMBOL_MAP` is the thermometer: every name still injected as text
        rather than imported is D7 debt, and `definedSymbols()` now exposes the count.

Deferred, and *not* stdlib modules: **`eval`** (needs a runtime AST interpreter — a phase of its
own; it is **LL0236** on both backends now, not the host's `eval`) and **quasiquote/unquote** (do
not exist).

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

## ✅ Phase It: Protocols back the syntax (D29) — iteration first (D30)

**Theme:** "A construct is an interface, lowered per backend."

The strategic ruling (**D29**): surface constructs -- `for :each`, generators, `async`/`await`, later
`with`/`?` -- are **defined by stdlib interfaces** and **lowered per backend**, not hardcoded in the
code generator. Stolen from C#/Rust/Swift, and it is *why* Phase 6/7 can swap in an LLVM backend: the
desugaring is written once against the protocol; only the leaves change (JS `for...of` / `function*`,
LLVM vtable + `llvm.coro.*`). The insight that makes it cheap: **on JS the runtime already IS the
protocol**, so lowering is the native form, not a reimplemented state machine.

*   [x] **Ita — the iteration protocol.** `Iterable<T>` / `Iterator<T>` in `lib/std/iter.lisp`; `next`
        returns `T?` (nil = done, folding D9). **D29**, **D30**. Interfaces only, no behaviour change.
*   [x] **Itb — `for :each` types its element.** `visitForEach` binds the loop variable to `T` via a
        user type's `:implements Iterable<T>` conformance or a native `T[]`'s blanket conformance
        (String/Map bind Unknown for now -- `for...of` over a Map yields `[K,V]` pairs and l-lang has no
        settled tuple type; naming it wrongly is worse than Unknown). A known non-iterable scalar in
        `:from` is **LL0221**. Codegen unchanged (`for...of`). The mechanism is gated (an array-of-structs
        loop-var field now resolves instead of hitting `__ll_member`); the corpus `for :each` sites that
        stay on the thermometer are array-of-MAPS, which need record types to resolve `user.name`.
*   **Generators (D31).**
    *   [x] **Ga** — `:gen` + `yield` → `function*`. A generator object is natively iterable, so
            `for :each` over one runs through the existing `for...of`, end to end.
    *   [x] **Gb** — the diagnostics: `yield` outside `:gen` (LL0222), value-`return` inside `:gen`
            (LL0223), a non-`Iterator` return type (LL0224), `yield x` checked against `T` (LL0225), and
            an empty-`:gen` warning (LL0226).
    *   [x] **Gc** — the bridge for a hand-written `:implements Iterable` struct (a NON-generator). A
            `[Symbol.iterator]()` method is injected on any `:implements Iterable` type, delegating to
            `__ll_js_iter` which adapts the user's `next() -> T?` to JS's `{value, done}`. Makes Itb's
            user-conformance path actually consumable by `for...of`. Generators need none of it.
*   **LINQ (D33).** The C# LINQ steal, now pure stdlib (`lib/std/linq.lisp`): lazy `:gen` operators over
    the iteration protocol, surfaced by the working infix `|>` -- `(coll |> (map f) |> (filter p) |>
    (take 3))`. Collection-first, so the pipe threads each stage — and, as of **Phase N**, the SAME
    signatures ARE extension methods (`((coll.map f).filter p)`), typed and lazy. Pipe stays primary.
    *   [x] **La** — the uniform cursor. `iter`/`next` runtime builtins (`iter` reaches through
            `[Symbol.iterator]`, inexpressible in l-lang -- the `head`/`elem` family), spanning array,
            generator and `:implements Iterable` struct alike. `Iterator<T> :implements Iterable<T>` so
            chains type-check. The inverse of Gc's `__ll_js_iter`.
    *   [x] **Lb** — the straight-through operators: `map filter enumerate concat skip skip-while
            flat-map`, each a collection-first `:gen` over `for :each`.
    *   [x] **Lc** — early-exit (`take take-while zip`, pulling the raw cursor since `for :each` has no
            `break`) and terminals (`to-list reduce count for-each`). The **laziness proof**: an
            unbounded generator `|> (map ...) |> (take 3) |> to-list` terminates and yields `[0 1 4]`.
    *   [x] **Ld** — the rulings: **D33** (the library) and **D34** (modifier composition: `:extension`
            is a DISPATCH modifier, `:gen`/`:async` are BODY modifiers -- orthogonal, so `:extension
            :gen` is coherent).
    *   [x] **Le** — the `std/seq` × `std/linq` boundary, ruled a **deliberate two-convention split**
            (D33): `std/seq` is eager/collection-last/functional-order, `std/linq` is lazy/collection-
            first/pipe. Not a duplication to collapse — pick one per file.
*   **async (D32).** The JS runtime already gives it -- `:async` is an `async function`, `await` an
    `AwaitExpression` -- so unlike generators the RUNTIME was live; the TYPE layer was absent.
    *   [x] **Aa** — the protocol: `Awaitable<T>` / `Task<T>` in `lib/std/async.lisp`. **D32**. No
            behaviour change.
    *   [x] **Ab** — the type rules: `(await Task<T>)` unwraps to `T`; `(return x)` in an `:async` is
            checked against the PAYLOAD `T` (fixed the live LL0213 false positive on every annotated
            async function); `await` outside `:async` is **LL0227**; a non-`Task` return type is **LL0228**.

## ✅ Phase M: Compilation units and package-scoped visibility (D35)
The module becomes a **package** — a `package.yaml`-declared compilation unit — so `internal` has a
boundary to mean anything, and std **extension modules** have a home. The manifest is a boundary marker,
not a package manager (deps/versions/config are a later phase). It lowers per backend (npm `exports` on
JS, `hidden`/`internal` symbol linkage on native) — emission later; the model is settled.
*   [x] **Ma** — the manifest + `PackageRegistry` + name-resolution (additive, at search-path priority);
        the stdlib re-expressed as 10 `lib/std/X/{X.lisp, package.yaml}` packages, resolved by name.
*   [x] **Mb** — the package as the unit: co-processing (import a package → union of its files' exports)
        and a package-scoped visibility boundary (siblings see each other with no export/import).
        `std/linq` split into two files, one package, as the demonstrator.
*   [x] **Mc** — the three levels: `public` (exported), `internal` (default, package), `private`
        (file/type — **LL0206** cross-file). `protected` **removed** (a no-op, and the impl-inheritance
        leak Go/Rust drop): `:protected` is now **LL0015**.

## ✅ Phase E: `:extension` methods (D34)
Adding behaviour to a type from outside its public API (OCP) — a struct you own, a protocol, a foreign
type. Dispatch is **compile-time nominal**, correcting D34's runtime-registry sketch: `__ll_is_type`
can't match an interface, but the checker knows `:implements` conformance.
*   [x] **Ea** — the mechanism. `(x.m a)` lowers to `m(x, a)` when x's static type is a nominal user
        type lacking a native `m` and an `:extension m` conforms (nominal walk of the receiver's type).
        Native members win; arrays never resolve (no shadowing `arr.map`); untyped → `__ll_member`.
        Codegen-only, no runtime registry.
*   [x] **Eb** — the discipline: an `:extension` with no receiver parameter is **LL0229**. `:extension
        :gen` demonstrated — a lazy filter method (`(c.where p)` → the generator `where(c, p)`).

## ✅ Phase T: typed surfaces — the generic stdlib, and native member types
Two thermometer/stdlib pieces. Both smaller than they looked: **call-site generic inference already
worked** (Phase 5, P5b-d), so the generics half was just declaring signatures; native member typing was
the real work.
*   [x] **Ga** — `first`/`last`/`at` in `std/seq` declared generic `<T> [coll <- T[]] -> T?`, so
        `(first [1 2 3])` types `Int?`. No new machinery — the stale "Se" gate (`-> T?` at the call site)
        was passing and is un-pended. No corpus ripple.
*   [x] **Ja** — a native-member side table (`nativeMembers.ts`, String/Array), so the checker types
        `s.toUpperCase` → `String`, `s.length` → `Int`, `arr.shift` → `T?`. Never a nominal String/Array
        symbol (that breaks primitive assignability); a table both resolvers consult.
*   [x] **Jb** — codegen honours it: a typed String/Array member emits a direct `.member()` / `.member`,
        not `__ll_member`. `std/string` (receivers `<- String`) now emits ZERO. Closes the String/Array
        half of the thermometer.

## ✅ Phase N: LINQ method-chaining (D33, built)
D33's "method-chaining surface is **reserved, not built**" is now **built**: the collection-first
`:extension` operators chain method-style (`((coll.map f).filter p).take 3).to-list)`) over any `Iterable`,
lazily, alongside the pipe (which stays primary). Four enablers, a dependency chain.
*   [x] **Na** — interfaces record `:implements`. `visitInterface` dropped it, so `Iterator :implements
        Iterable` never held and `isSubtype(Iterator, Iterable)` was always false — a latent
        interface-extends-interface bug, not just LINQ. `isSubtype`/`receiverConformsTo` walk it transitively.
*   [x] **Nb** — the checker TYPES an `:extension` call as its instantiated return (was Unknown), via
        `conformsNominally` (array-excluding) + `instantiateSignature`, published to the node-type channel.
        A chain intermediate `(gen.map f)` now types as `Iterator<…>`, so the next `.filter` resolves.
*   [x] **Nc** — codegen dispatches on a COMPUTED chain intermediate, reading the node-type channel Nb
        filled (the 2nd+ hop `((gen.map f).filter g)` was raw `map(gen,f).filter(g)` — a crash).
*   [x] **Nd** — the linq operators are typed `:extension`; a `:gen` `seq` gateway lifts a bare array into
        a lazy chain (`((seq arr).map f)`). `isSubtype` treats the iteration protocol nominally +
        element-gradually (an array satisfies `Iterable`, so the PIPE still threads it) while dispatch stays
        nominal (a bare `.map` stays native-eager). Headline: the chain runs lazily over an INFINITE
        generator. (Also fixed a latent bug — dispatched IMPORTED extensions were never inlined.)
*   [x] **Ne** — a lazy-only op method-style on a bare array (`(arr.take 3)`) is **LL0230** with a fix hint
        (the pipe, or `seq`), not a silent compile → runtime `arr.take is not a function`.

## ✅ Phase U: tuple types (`[Int String]`)
Fixed-length, heterogeneous, positional types — the first half of richer types. A tuple is a JS array at
runtime, so **codegen is unchanged**; the work is grammar + type-system. Unblocks the destructuring xfail
and makes `enumerate`/`zip` honest.
*   [x] **Ua** — grammar: a leading-`[` tuple type parses (both frontends; array stays postfix `Int[]`),
        with a `TupleTypeNode`. Was a hard parse error.
*   [x] **Ub** — the type: a `"tuple"` `InferredType`, `convertAstType`, and TypeChecker rules
        (element-wise equality/assignability; a tuple is DISTINCT from an array). Absorbed the planned Uc.
*   [x] **Ud** — destructuring bindings get element types from the annotation (`[x y] <- [Int Int]` types
        `x`,`y` as `Int`); param, `let`, and (Uf) for-each sites.
*   [x] **Ue** — EXPECTED-TYPE (bidirectional) inference: a vector literal infers against an expected tuple
        (`[0 "a"]` becomes `[Int String]`), at the `let`/return/yield sites — so tuple values are
        constructible, not just annotatable.
*   [x] **Uf** — a destructured for-each loop var is typed from the element (`Iterator<X>` yields `X`), the
        consumer side.
*   [x] **Ug** — `enumerate` → `Iterator<[Int T]>`, `zip` → `Iterator<[A B]>`: the pairs are typed, so a
        consumer's destructure carries real element types. Closes the LINQ loose end from Phase N.

## ✅ Phase R: record types (`{:name <- String}`)
The second half of richer types — structural objects, for field-typed maps and JSON-shaped data. A record
is a JS object at runtime, so **codegen is unchanged**. Both DECLARED (annotation) and INFERRED (from a map
literal) — the annotation `{:f <- T}` already parsed; it was just dropped in the type layer.
*   [x] **Ra** — the DECLARED annotation is wired: `convertAstType`'s `map-type` branch → a `"record"`
        `InferredType` reusing the struct `members`, so the member-walk types field access (dot AND colon
        path). A `(deftype Person {...})` alias resolves its fields.
*   [x] **Rb** — INFERRED records: a map literal retains its per-field types (`{:name "x" :age 3}.name` is
        String), `members` additive on the `map` kind so every map consumer keeps working.
*   [x] **Rc** — STRUCTURAL assignability: width + depth (`{:a Int :b Int}` → `{:a Int}`), field-wise
        `typesEqual` — the first structural (non-nominal) rule in the checker.
*   [x] **Rd** — docs + the corpus reconciliation (the `{:f <- T}` arrow form; `18_destructuring`'s tuple
        AND record params now type, the file blocked further on aspirational match-destructuring).
    *   Known gap: a FULLY-computed field read `(get xs i).name` (inline, no intermediate binding) drops
            the member — the `case "member"` / computed-call path; works via a named intermediate.

## ✅ Diagnostics centralization: the `rules/diagnostics` registry (D38)
Every imperative compiler diagnostic — five `report*` helpers hardcoding a `(code, message)` literal at each
call site, across four visitors and `Context` — folded into one registry. A diagnostic is now a
`def(code, severity, template)` in a per-domain category file; call sites read `this.report(D.X, node, params)`
(visitors) or the free `report(ctx, D.X, node, params)` (`Context`, `JSClassBuilder`). Behaviour-preserving,
proven by a characterization snapshot (`test:diagnostics`, 42 probes, byte-for-byte). Sub-phases Ea–Ee — the
"E" is for *errors*, distinct from the older Phase E (`:extension`).
*   [x] **Ea** — the core: `def`/`report` (a leaf module, imports all type-only), `BaseAstVisitor.report`, the
        registry aggregate, and the gate — integrity (one severity per code, `LLdddd`) + a free-code ALLOCATOR
        (next-free per band) + the characterization snapshot. Both gates proven RED-first.
*   [x] **Eb** — the type band (LL0200–LL0230), 34 sites, `−100` lines in `InferTypesAstVisitor`. A code may
        back several named variants (LL0204 unary/binary, LL0202); three byte-identical pairs deduped.
*   [x] **Ec** — syntax/modifier (LL0015–0019, LL0023); the declarative `NodeValidationRules` (LL0001–0022)
        stay self-testing, their codes registered as `EXTERNAL_CODES`.
*   [x] **Ed** — codegen (LL0100–0102), module (LL0217, LL0300), comptime (LL0099). The two DEVIANTS
        normalized: `reportUnfoldable`'s inline object literal, `reportImportError`'s baked-in code.
*   [x] **Ee** — docs (D38), this entry, `rules/diagnostics/README.md`, and the stale-comment sweep. All five
        helpers are gone; every diagnostic flows through `report()`.
*   [x] **Finding RESOLVED:** LL0015–LL0019 were OVERLOADED (imperative modifier diagnostics colliding with
        unrelated declarative rules). Direction chosen by reference-weight — a live test + all docs call LL0015
        the "unknown modifier" error — so the imperative codes KEPT LL0015–LL0019 and the five declarative
        colliders moved to LL0024–LL0028. The `test:diagnostics` overlap NOTE is now empty.
*   **Follow-ups (flagged, not done):** make the `test:type-errors` `LL02*` filter category-based (may surface
        currently-hidden diagnostics); fold the declarative rules into the registry too.

## ✅ Retiring the PEG and js-legacy: one frontend, one backend (D39)

*The "P" is for *pruning*. Closes the cycle D14 opened; driven by the post-audit adversarial sweep.*

*   [x] **Pa** — close the cutover gate honestly. `test:diff-frontends` read `v2-only failure 4 <-- real v2
        bugs, must be 0 to cut over`. The label was **wrong**: all four were stale corpus, not v2 bugs —
        examples in syntax the language does not have, which only the PEG accepted. Modernized
        `18_destructuring` (match arms), `20_scope` (D12 `for` + a capital-`Fn` type that never parsed on
        EITHER frontend), `02_maps` (colon-path → dot-path), `02_game_of_life` (for-OF). Gate → `0 / 0`, with
        **zero compiler changes**.
*   [x] **Pb** — the PEG is deleted. `frontend/grammar/`, `CompilationFrontend`, the `--frontend` flag,
        `diff-frontends`, the `peggy` dep. 11,545 lines. Seven audit findings evaporate with it (AF-009, -021,
        -025, -029, -030, -031, -032), including one S1 and one S2.
*   [x] **Pc** — js-legacy is deleted. An unmeasured second emitter cannot be the rollback it exists to be.
        1,035 lines. `codegen/llang/` kept (different target, not a duplicate).
*   [x] **Pd** — D39, this entry, and the constraint retirement.
*   **"Both frontends must agree" is retired as a standing constraint.** Every future phase gets cheaper.
*   **What Pa taught:** a permissive parser does not merely fail to catch corpus rot — it manufactures the
        appearance of working code, and the rot then gets blamed on the compiler. All four xfail reasons
        pointed at the wrong culprit. Worth re-reading before trusting any "blocked on Phase N" reason.
*   **Follow-ups (flagged, not done):**
    - implement the ruled `and`/`or`/`not` aliases (D39 — they do not exist today; only `&&`/`||`/`!`);
    - **`SimpleAssignmentNode` is now ORPHANED.** Its own comment said the form "is only reachable via the
      PEG frontend — grammar_v2 always builds a compound-assignment", and grammar_v2 indeed never emits
      `simple-assignment`. Pb therefore made the node kind unreachable, but it is still declared in `ast.ts`
      and still handled in `BaseAstVisitor`, `InferTypesAstVisitor`, and both emitters. Dead, not harmful —
      removing it means editing the node union + dispatch table + three visitors, which is a refactor, not a
      doc pass. Left standing deliberately.
    - `VALID_LANGUAGES` never listed `"llang"`, so the llang backend has no reachable CLI spelling despite
      Context dispatching it.
    - Historical PEG references in test comments are kept on purpose (they explain why each test exists);
      the ones that are now *actively* misleading were corrected in Pb/Pd, not blanket-deleted.

## 🧠 Phase 6: The Brain Transplant (v0.6.0)
**Theme:** "Prepare for the metal."

*   [x] **HIR:** a *typed, desugared* tree — **landed, then fully inverted** (D45). Two-sorted
        (statement/expression) node family in `src/compiler/hir/`, typed from the per-node channel.
*   [x] **Lowering:** AST → HIR — destination-driven (`lower(node, dest)`). Started at the conditional
        cluster (if/when/cond/match) + operand hoisting, then inverted **every** value-bearing node.
        Remaining: R3 (explicit stores/copy-insertion) and R4 (dispatch-at-HIR).
*   [x] **IR Codegen:** HIR → ESTree, mechanical, and now the **only** value-lowering path. The flag
        (`--no-hir`/`LL_HIR`) and the legacy IIFE/LL0103/`visitIf`-`visitMatch` machinery were cut.
*   [x] **The contract questions are ruled (D49).** The gap ledger's `new:` band asked for four
        language rulings. Two were not questions: `void-in-value-position` was a JS bug report wearing a
        C ledger row (D9 already answers it, and says JS is the non-compliant backend), and
        `module-global` was a tautological row measuring corpus shape. The two real ones: `-> Void` now
        BINDS (it suppresses the implicit return, as `:gen` does), and `Int / Int` is integer division
        (D43 applied literally, once its "JS has one number type" premise was seen to be false on a
        native target). Implementation follows; see D49.
*   [x] **The core tail (D48).** The readiness report's remaining dips resolved *onto* nodes. Step 1,
        the cheap drains, is **done** — the A5 copy-decision (as `copies` fields on `HReturn`/`HVarDecl`
        rather than a distinct `HCopyStore`), the field-get slot on `HMemberRead`, and callee-identity
        on the call nodes. **The core tail is DONE.** `HMatchTest` landed (A7 drained
        144 -> 2, its floor); the **closure representation** landed (HClosure carries the capture set and
        each capture's D10-derived mode); `HFor` gained a statement-bearing `:step`, draining the
        `raw-structural` family to zero; and **A1 field types** now ride `HFieldDecl`/`HCtorParam`, so a
        native backend no longer walks the class body to learn what a field IS. Governed by A-0: nodify what *both* backends decide;
        reclassify only genuine single-backend passes (A6 coercions leave core).

## 🔮 The language-feature lane (2026-07 design round)

The Sabaka⇄Dove design round (`docs/_archive/hir-design-round-brief.md`) ratified a lane of language
features on the now-solid HIR / coercion substrate. **Post-design-round sequencing:** the HIR core tail
(Phase 6, D48) → the conversion substrate (Cv) → bounded generics + ergonomics (Bg) → conditions /
restarts (Cr). All of it is JS-safe (degrades, no-ops, or refuses honestly), so none *depends* on native
surviving — it pays *extra* if native does.

### 🟡 Phase Cv — the conversion substrate (D46) — B-0/B-1/B-3 SHIPPED, B-2 open
The coercion pass reframed as the type system's checked-conversion layer. In order:
*   [x] **B-0 tokens:** `deftype`'s required `<-` binder, the `..` `Range` token, and the **`:satisfies`** modkw — *not* `:where`, which is still an unconsumed token claimed by Phase Bg.
*   [ ] **Native fixed-width ints (B-2):** `uint8`/`int32`/… → `uint8_t` etc. — a fixed-range refinement
        materialised as a native width. No-op-to-`Int` on JS.
*   [x] **Refinements (B-1), range half:** `T :satisfies (lo..hi)`, checked at every boundary
        (`cacc912`, `38d1c79`), plus D90's dimension half. **Open:** a general predicate, regex via a
        stdlib `matches?` predicate (B-1a), and record-field refinements on the field (B-1b).
*   [x] **`defcast` (B-3):** `:implicit` (one-hop, lossless-widening, at coercion sites) / `:explicit`
        (`(cast<T> x)`), keyed by type-pair on the operator devirt path.

### 🔮 Phase Tn — tensors: the last rung of the numeric tower

**Planned, not designed.** The tower reads **Int – Rational – Real – Complex – Vector – Matrix – … –
Tensor**, and D88/D89/D90 built every rung up to Matrix. Tensors are the natural next one and the
notation is the hard part, so this entry exists to hold the open questions rather than answer them.

What is already in place: a matrix literal has a TYPE (D89), its cells must share a **Ring**, and the
element rule carries over to a tensor unchanged. What is not:

*   **Notation.** `|` is spent on rank 2. Rank 3+ is either a new separator or **nesting** —
    `[[1 2 | 3 4] [5 6 | 7 8]]` parses *today* as a vector of matrices, so the shape exists and only
    the meaning is missing.
*   **Slicing is already on the critical path, and it does not parse at all.** Measured 2026-07-28:
    `t[1 .. 2]` dies with `Expecting token of type --> RBracket <-- but found --> '..'`, thrown as a
    raw Node stack from `AstProvider`, not as a diagnostic. **LL0034 fires only for a standalone
    `(a .. b)` list** — the span element is built solely by the LIST rule's fall-through, and
    `indexerSuffix` consumes plain expressions, so the spelling D88/N4 reserved is currently a syntax
    error in indexer position. Making the indexer reach the span is part of the work, not a
    precondition already met. The multi-index `t[i, j, k]` *does* parse
    (`05-data-structures/03_matrices.lisp` uses `m[0, 0]`).
*   **Shape in the type.** `Tensor<Real, [2 3 4]>` needs value-level generic arguments. Unchecked
    shape is the tractable alternative and probably the right first cut, the same way declaring
    derived units was the tractable cut of D90.
*   **Broadcasting** (numpy-implicit vs explicit) and **contraction notation** (einsum-ish vs named
    `matmul` / `tensordot`) are each a RULING, not an implementation detail.
*   **Where it lives** — a language-level literal, or `std/math/tensor` — is itself open.

Sabaka has notes on the notation; nothing here should be settled before they land.

### 🔮 Phase Bg — bounded generics & ergonomics
*   [ ] **The three `:where` relations** (`:is` / `:extends` / `:implements`, type-variable subject only)
        — reuse the existing `typesEqual` / `isSubtype` / `conformsStructurally` predicates.
*   [ ] **Small greenlit ergonomics:** `|> .method` selectors (desugar over the pipe), flags enums
        (`:with Flags`), `with`-copy (`(with s :field v)`), `:readonly` fields, `:stack` allocation
        (needs escape analysis). *(Attributes → reflection LANDED as D68/D72 — spelled `defattribute`
        + `:name[args]`, not `:with Attr`.)*

### ✅ Phase Cr — conditions / restarts (D47) — DONE
*   [x] **The resumable kernel** — `restart-case` / `handle` / `signal` / `invoke-restart`: a second,
        *resumable* exception mechanism beside `try`/`catch`. **C-native, JS-refused** (the mirror of
        C-refused coroutines). The known hard part landed first: Cr-0 unified `try`/`catch`/`finally`
        onto one `ll_frame` stack walked by one `ll_unwind`, so a restart transfer runs intervening
        `finally` cleanups **by construction** rather than by a parallel mechanism. Then Cr-1a
        (`restart-case` + `invoke-restart`) needed a single `f == target` branch, and Cr-1b (`handle`
        + `signal`) added `ll_signal`'s in-place LL_HANDLER walk plus a new lifted-handler ABI
        (`(void*, ll_value) -> ll_value`) with one shared env per form.
*   [x] **Conformance suite** — `examples/19-conditions/`, 21 programs, expectations hand-derived from
        D47 (JS refuses these, so it is not the oracle) and confirmed against C. Beyond the mechanism
        itself they pin the compositions: a signal never fires an intervening `catch`; a restart unwind
        runs CLEANUPs but skips CATCHes; a handler's `throw` propagates from the *signal's* context;
        frame-pop discipline on `return` and on normal function exit; recovery on every loop iteration.
*   [x] **Two correctness finds from adversarially probing it** — a declining handler was skipping the
        remaining clauses of its own `handle` form; and, wider than D47, the C11 7.13.2.1p3
        setjmp-clobber (a local written in a protected body and read after a landing is indeterminate
        unless `volatile`) affected **plain `try`/`catch` too** — silently wrong at any `-O` above 0.
        Both fixed; `npm run test:c:o2` now fences the second, which `-O0` structurally cannot.

### 🔮 Phase G — coroutines on the native backend (D58–D60)

Ratified in the 2026-07-23 round over `docs/_archive/coroutines-and-memory-brief.md`. The C backend has
refused `:gen`/`:async` since the probe began (LL0105, spec gap A8); this builds **`:gen` only**, which
drains the entire lazy sequence library to C — 11 generator definitions of 15 exported operators — and
*is* the LLVM coroutine work, since the transform is HIR-level and backend-neutral. `:async` stays
refused by ruling (D60), and the collector (D59) is a separate lane.

*   [x] **G1 — carve the rulings, narrow the surface.** D58/D59/D60; D30 gains `Disposable`; D31 gains
        the three rules that had **zero corpus sites**: a valueless `(yield)` is **LL0237**, a nullable
        element type **LL0238**, and `yield` inside a protected region **LL0239** — the last
        *language-wide*, because the alternative was shown to be UB rather than a tradeoff.
*   [x] **G2 — `HYield` as a core source node.** It was emitted on the legacy JS leaf path, so the
        native pass had nothing to consume. Pure nodify; the `13-generators` JS golden was the test.
*   [x] **G3 — the generator instance.** Displays as `#<generator name>`, reflects as
        `kind: "generator"`, class hidden — D58's parity ruling. JS brands the native `function*`'s
        prototype rather than wrapping it in a class: same observable contract, no wrapper allocation,
        native iteration untouched. Caught the leak Dove predicted (`#<generator __ll_inlined_map_1>`).
*   [x] **G4a — the interface-typed slot.** Predicted blocker; **measurement retired it** — the slot
        already boxes, by two lookups failing rather than by a decision, so it got a guard instead of
        a fix (ledger §12.1).
*   [x] **G4b — destructuring `for :each` on C.** A real blocker, and unrelated to coroutines: the
        element read is bounds-guarded (JS gives nil where `ll_index_vec` traps) and the names are
        declared beside the element variable so `:else` can read them (ledger §12.2).
*   [x] **G4c — the state machine.** `HDispatch`/`HSuspend`/`HResumePoint` as non-core pipeline nodes;
        `c-dispatch`/`c-label` in the CIR; the frame is `ll_obj.fields[]` with **every** local promoted
        (D58 amended — see there for why the typed `envStruct` was not built). No CFG flattening and no
        live-range analysis: C's `goto` enters a loop body, so the body is emitted verbatim.
        `13-generators/00` and `30-applications/07_line_clear` join the ratchet against their existing
        goldens; `16-stdlib/02_linq_pipeline` is blocked on ledger §13 (`:extension` method-surface
        dispatch is not resolved on C) and on nothing else.
*   [x] **G4d — the `:extension` method surface.** Not planned; found the moment G4c let
        `02_linq_pipeline` run. `(coll.filter p)` on a boxed receiver went to `ll_dyn_method`, which
        searches a method table that by construction never holds a free function. Two receiver shapes,
        resolved two ways (ledger §13.1). Unblocked `16-stdlib/02_linq_pipeline` and, via the ratchet,
        `30-applications/02_interface_conformance`.
*   [~] **G5 — disposal.** The LIBRARY half is built: `dispose` is a floor operation, and
        `take`/`take-while`/`zip` release the source they abandon — "where the real leak lives" (D58).
        Two of that ruling's mechanisms did not exist and are amended there: recognition is
        **duck-typed** (`(x :of SomeInterface)` answers false on both backends, ledger §14.1/§14.2) and
        what is disposed is the **collection**, not the cursor (`iter` returns different kinds of thing
        per backend, §14.3). The `for :each` half is **not built** and wants a ruling: with disposal
        keyed on the collection it would release a source the program may still reuse, and l-lang has
        no per-loop enumerator to dispose instead (§14.4). Closed ledger §11.1 on the way — the
        implicit-return desugar never honoured its documented `:gen` exemption, which four diagnostics
        probes had been blessing.
*   [ ] **G6 — the collector (D59).** Separate lane. The bounded-RSS acceptance test lands **RED
        first** — nothing in the corpus measures memory today.

## ✅ Phase C — the native backend, and the polarity flip (D49, D81–D87)

**Theme:** "Stop calling it a probe."

The C backend has no phase in this document and is 7,204 TypeScript lines across
`src/compiler/codegen/c/` plus a 2,751-line `runtime.c`. It began as an adversarial probe of the HIR
contract — the instrument that measured whether the IR carried enough to feed a typed backend — and
it finished as the reference implementation.

- [x] **The pipeline.** HIR → `ResolveHirToCir` (P1) → `InsertCoercions` (P2) → `EmitCirToC`, with
      every reach below the HIR recorded through `dipAst` / `dipNodeTypes` / `dipSymbols` and an
      `(assumption, construct, note)` triple. That instrument is what made the readiness question
      answerable instead of arguable; its taxonomy is `docs/inbox/hir-llvm-consumption-spec.md`.
- [x] **Fail-closed refusal, not wrong code.** `LL0105`–`LL0107` are the refusal band: the emitter
      says what it cannot do and stops. A green C file is therefore a *true* positive.
- [x] **The ratchet.** `src/test/c-status.ts` — an allowlist that GROWS. Unlisted-and-passing turns
      the build red demanding promotion, which is how the backend advanced without anyone tracking
      it by hand.
- [x] **The `-O2` fence.** C11 7.13.2.1p3: a local clobbered across a `setjmp` landing is
      indeterminate unless `volatile`. At `-O0` the reads happen to work, so only `test:c:o2` can
      falsify the emission — and it caught a live bug in plain `try`/`catch`, not just in D47's
      restarts.
- [x] **D86/D87 — the polarity flip.** C is the specification where the backends disagree; JS is a
      frozen second implementation whose value is that a disagreement is worth *looking at*. The
      `oracleDivergent` manifest field is what let a file be graded on C while the frozen oracle is
      measurably wrong.
- [ ] **The refusals that remain:** `:async` (D60, by ruling), nested and lambda generators, and
      decoration-time setup hoisting. Five files, listed in `c-status.ts`.

## ✅ Phase Lx — the language-surface round (D61–D75)

**Theme:** "The `:foo` sigil meant three things and nobody had said which."

Rulings D61 through D75 have **no box anywhere in this document**, which is how twenty-two of the
thirty most recent rulings came to be invisible here. They are one coherent round.

- [x] **D61** bit operators — Int only, 64-bit wrap, masked shifts, arithmetic `shr`
- [x] **D62** `std/core/errors` — a typed error tower on the ambient `Error`, with `cause`
- [x] **D63** the protocol family — `Comparable` / `Hashable` / `Formattable`
- [x] **D64/D65** `std/sys/path` (paths are a value type) and `std/math/random` (seeded determinism)
- [x] **D67** regex — the engine is **l-lang**, `r"…"` is a raw string, `f"…"` the formatted one,
      and match arms take a pattern. One program, two backends.
- [x] **D68/D72** `:foo` is **three roles** — modifier, decorator, attribute — and the third gets
      `defattribute` plus an adjacency-gated `:name[args]` argument form
- [x] **D69** the metaprogramming tiers, distinguished by what the handler *receives*
- [x] **D70/D71** enum RTTI; numeric lexis (`_` separators, `0o`, and the octal contradiction)
- [x] **D73** `:comptime` runs on an **in-house interpreter** — `node:vm` left the compiler, which
      also removed D69's stated blocker on ever deleting the JS backend
- [x] **D74** a match pattern's string decodes like every other string
- [x] **D75** `defmodifier`'s contract is **flat**, with a setup slot — a breaking change, migrated
      across the corpus, the games repo and `src/test/codegen.ts`

## ✅ Phase Sl — the stdlib build-out (D76–D80)

Six modules in one round, each ruled before it was written.

- [x] **D76** `std/core/builder` — because `+` in a loop is quadratic
- [x] **D77** `std/text/json` — the engine is l-lang; the escape table is pinned by the host
- [x] **D78** `std/time/calendar` — proleptic Gregorian civil time, UTC, **zero** floor entries
- [x] **D79** `std/log` — a logger takes a `Clock`; an event is a name plus properties
- [x] **D80** `std/cli` — parse answers a value, dispatch is a thin layer over it
- [x] **D82** a data error is CATCHABLE, a contract violation is not — the rule that makes the tower
      usable rather than decorative

## ✅ Phase Nm — the numeric tower (D88–D90)

**Theme:** Int – Rational – Real – Complex – Vector – Matrix – … – Tensor.

- [x] **D88** the tower's scalar floor: `1/2`, `3+4i`, `0xFF`/`0o17`/`0b1010`, promotion through an
      `:implicit` defcast at operand positions, and `..` binding by **adjacency** (a standalone `..`
      is LL0034; 16 corpus files migrated off the spaced form)
- [x] **D89** `Ring` is the fourth protocol, a **primitive** can answer one, and a matrix's cells
      must share it — which also found that **no desugar had ever reached a matrix cell**, because
      `MatrixNode.rows` is the only array-of-arrays field and every rewriting visitor mapped one level
- [x] **D90** units of measure — a `:satisfies` refinement can be a **dimension**; `*`/`/` compose
      exponents, `+`/`-` require equality, assignability compares dimensions rather than names, and
      the whole thing erases (no `ll_refine_check_*` call site)
- [ ] **Arity.** Both rules live in the two-operand branch — see Known gaps.

---

## 🚀 Phase 7: The Speed of Light (v1.0.0)
**Theme:** "The Sloth becomes a Cheetah."

*   [ ] LLVM IR codegen visitor
*   [ ] Strict memory layout
*   [ ] Native standard library

---

## Known gaps

Live, reproduced, and deliberately not yet fixed. Full evidence in `docs/spec/DECISIONS.md`.

### A `deftype` over `Map` is unusable in BOTH positions — and it cost `std/core/types` an alias

Found while fixing `std/core/types`'s broken aliases. `Str <- String`, `Bool <- Boolean`,
`Number <- Int | Real` and `List <- Any[]` all work. A `Map`-based one does not, in either position:

```
(deftype D <- Map)
(let d <- D {"a" 1})            LL0200 Type mismatch: cannot assign Map to D
(fn f [d <- D] ...) (f {"a" 1}) LL0203 Argument 1 of 'f': expected D, got Map
```

It DECLARES fine, so the gap only shows at a use. `std/core/types` shipped `Dict <- Object` —
`Object` is not a type the language has, so it was broken differently — and repointing it at `Map`
would have replaced a wrong alias with an unusable one. `Dict` is deleted until this closes; it had
zero call sites, so nothing is waiting on it.

The gap is general: it hits any user writing `deftype MyMap <- Map`, which is the obvious way to name
a domain dictionary type.

### Should `dispose` recognise its target NOMINALLY? — the premise for duck-typing has expired

`ll_dispose` finds its target by looking for a callable `dispose` MEMBER, not by testing `Disposable`.
That was an amendment to D58, and its stated reason was:

> `(x :of SomeInterface)` answers false on BOTH backends today, even for a type that declares
> `:implements`, so the nominal test the ruling named does not exist to call.

**Measured 2026-07-31: every part of that is now false.** A single declared interface, the SECOND of
two on one declaration, and a transitive one (`Iterator<T> :implements Iterable<T>`) all answer
`true`, on both backends — pinned by `80-adversarial/interface_conformance_of.lisp`. The companion
gap-ledger note that *"`:implements A B` records only the first interface"* is stale with it.

D58's own text rules the other way — *"A consumer type-tests instead: dispose what is `Disposable`,
leave everything else alone."* So the duck-typing is a workaround for a defect that no longer exists.

**It is not changed, because it is not free.** `80-adversarial/disposal.lisp`'s `Res` and `Letters`
each carry a `dispose` member and declare only `:implements Iterable` — under a nominal test they
would stop being disposed, and the file's whole subject is that they are. So this is a semantic change
to what disposal recognises, wanting a D-number:

* **nominal** — D58 as ruled; `Disposable` stops being decorative; two corpus types must declare it.
* **duck-typed** — today's behaviour; then `Disposable` is documentation and should say so, since
  nothing consults it.
* **both** — dispose anything with the member, and make `:implements Disposable` without one an
  LL0209 error, so the interface at least constrains its implementors.

### A runtime quasiquote is refused as "no lowering exists", which misreads as a gap

`` `(+ 1 ~n) `` outside a `:comptime` context is `ELL0106 Cannot generate C for 'quasiquote': no
lowering exists` on C and `ELL0100` on JS. The refusal is CORRECT -- a quasiquote is a compile-time
template constructor, and `80-adversarial/quasiquote.lisp` states it: *"EVERYTHING HERE IS FOLDED
BEFORE CODEGEN … the templates are built and consumed inside the compiler."*

But the wording says "no lowering exists", which is how this project spells an unbuilt feature — and
`CLAUDE.md` claims there is no longer a construct the reference backend declines for that reason. A
reader checking that claim finds this and cannot tell a ruling from a gap. It wants a message naming
the tier ("a quasiquote is a compile-time template; it has no runtime value"), which is a diagnostics
change with its own snapshot rather than part of a typing round.

### `findCommonType` does not dedup a union — `Int | Int | String`

Pre-existing, found while typing `cond` (D112) and confirmed NOT to be caused by it. Both the
`match` and nested-`if` paths already do it:

```
(match n { 1 => 10  2 => 20  _ => "x" })   ->  Int | Int | String
(if a 10 (if b 20 "x"))                    ->  Int | Int | String
```

Three arms of the same type collapse (`findCommonType` short-circuits when ALL are equal), so it only
shows on a genuine mix. Not known to change assignability — it surfaces in diagnostic text — but a
union type with duplicate members is malformed, and the function is core enough that widening a
form-typing round into it was the wrong trade.

### A `cond` clause spelled `(else b)` cannot exist, and the C backend tests for it

`ResolveHirToCir` computes `isElse` as *"condition is a `simple-identifier` whose id is `else`"*. That
shape never reaches it: `(cond (c 1) (else 2))` is `ELL0210 'else' is not defined` — an ordinary
undefined identifier — and `AstBuilder.condCase` rewrites the real `(:else b)` spelling to a literal
`true` condition, deliberately, so "codegen, the checker and every golden see one shape". So the test
is dead code checking for a form the grammar does not produce. Harmless today; it misled the D112
typing work into believing there were three default spellings when there are two.

### LL0240 cannot see a SIBLING collision — UNRULED, and it has produced a wrong answer

The diagnostic for "two modules export the same name, and which one you get depends on module order"
fires for two DIRECTLY IMPORTED modules and **never** for package siblings — a sibling arrives by
injection, not by import, so it is not in the set `ambiguousDirectImports` examines.

Measured, and it is not theoretical. `std/llang/ast` and `std/llang/reflect` shared five predicate
names asking different questions (`n._type` on an AST node vs `t.kind` on a runtime type descriptor):

```
(import "std/llang/reflect")          (is-class d)  ->  true
(import "std/llang/ast")              (is-class d)  ->  false     same descriptor
ast then reflect                                    ->  false     decided by ORDER
reflect then ast                                    ->  true
```

Zero diagnostics in all four. LL0240's own text describes precisely this hazard — *"which one that is
depends on module processing order — so a program that reads correctly today can change meaning when
an import is added"* — and it cannot see the case.

**That instance is fixed by renaming** (the AST predicates carry `-node`; they had zero callers, and
every caller in the tree wanted reflect's meaning), pinned by
`80-adversarial/sibling_name_collision.lisp`. **The general question is not**: two live cases remain —
`min`/`max`/`abs`/`floor`/`ceil`/`round`/`PI`/`E`/`TAU` across `math/math`, `math/elementary` and
`math/constants`, and `read-lines` at arity 0 in `io/console` versus arity 1 in `io/files`.

Ruling needed: is a same-package duplicate export an ERROR, a warning, or legal-and-ordered? Making
it an error is the only option that cannot produce a silent wrong answer, and it is also the only one
that would refuse code in the tree today.

### Should a MODULE import drag in its package siblings? — UNRULED, and it has a measured price

Surfaced by fixing `std/sys` from a phantom package into a real one (B0 of the stdlib sweep). The fix
was correct and it turned on a behaviour nobody had been paying for:

`std/debug` imports **`std/sys/process`** — one module, for `args`. Because a real package injects its
siblings, `path.lisp` and `timers.lisp` are now compiled into every program that does so. Measured on
`examples/80-adversarial/debug_panic_is_fatal.lisp`:

| | emitted C | `cc -O2` |
|---|---|---|
| `std/sys` phantom (before) | 242,611 B | **9.4 s** |
| `std/sys` a real package (after) | 303,490 B | **26.9 s** |

+25% code for **+186% compile time**, and it pushed the file past the runner's 30s `cc` budget — which
is why that budget is now 90s. The `-O2` cost is superlinear in unit size: the same file is 0.35s at
`-O0`, a 77x optimiser multiplier.

**The question is not the timeout, it is the semantics.** A program that asks for `std/sys/process`
gets two modules it never named and cannot use. Package-scoped `internal` visibility is the reason the
injection exists, so this is a genuine trade rather than an oversight — but nothing charges for it and
no ruling states it. Options, unpriced: inject siblings only for a PACKAGE import (`(import
"std/sys")`) and not a module one; inject lazily, only when an `internal` reference actually crosses;
or accept the cost and say so.

**This is the same machinery** that made moving contracts into `std/core/protocols` unsafe — there it
surfaced as `std/core/string`'s free `join` shadowing the native array method, which is why the
protocols relocation targets a sibling-free package instead. Compile time and name shadowing are two
faces of one unruled decision.

### `l-lang run` cannot read stdin on the JS path — WONTFIX by D66

Found while fixing the same defect on the C path (D103's round). `echo hi | l-lang run f.lisp`, where
`f.lisp` calls `read-line`, dies with **`ReferenceError: Buffer is not defined`**: `std/io/stream`'s
reader allocates a `Buffer`, and `compiler/runtime/evalInScope.ts` seeds its sandbox with
`console`/`JSON`/`Math`/`process`/`require`/timers/`fetch` and not `Buffer`.

It is a one-line fix and it is **deliberately not applied**. D66 is explicit that no new fixes land on
the JS path, and D103 made that lane an instrument rather than a gate.

**D104 changed what this costs.** It was written when JS was the CLI default, so the sentence read
"`l-lang run` on the default backend cannot read stdin" — the worst version of the gap. C is the
default now, `read-line` works there, and reaching this defect takes an explicit `--backend js`. The
gap is unchanged; its blast radius went from *everyone* to *whoever opts into the oracle*.

### ~~Destructuring: rest, nesting, and parameters~~ — **CLOSED**

Three refusals, two absences.

**`...rest` and nesting** were one: each pattern arm bound `identifier-pattern` leaves and had no way
to **descend**. Nesting is one recursive call; the tail is one clamped `ll_vec_slice`. Each level
binds a temp, so its subject is evaluated exactly once — `(let [a b] (next-pair))` must not call
`next-pair` twice, and a nested form must not re-read its sub-subject per leaf.

**A destructured parameter** is the same lowering reached from the other side: an ordinary boxed
parameter under a synthetic name, plus the statements the declaration form emits. Both go through one
`emitPatternBind`, because writing it twice is how the two would drift.

**The hazard was the wiring, not the lowering** — `declareParam` has **8 call sites** and only **4**
build a prologue, so returning the statements would let the other four drop a parameter's bindings
silently. They go on a queue that `resolveFunctionBody` drains and that `isolated` asserts is **empty
on the way out**: a path that declares such a parameter and never builds a prologue is refused by name
(`param-destructuring-undrained`) instead of emitting a function whose body reads names nothing
declared. That assertion is the whole reason this was safe to build.

**And the signature had to learn it too.** The checker types `[[x y]]`'s parameter as `Int[]`, so the
signature said `ll_vec*` while the definition said `ll_value`, and `cc` rejected every call site. A
destructured parameter is now the third thing that overrides the checker in `registerTopLevel`, beside
a rest parameter and an annotation.

`04-pattern-matching/04_destructuring.lisp` moves from **refused to passing** — and it was the last
refusal that was not a *ruling*. The two remaining are `:async`, refused by D60.

Guarded by `80-adversarial/destructure_rest_nested.lisp` (declarations) and `destructure_params.lisp`,
which exercises the **seams** rather than the syntax: a plain function, a lambda and a method are three
different emitters, and the pattern sits in the *middle* of a parameter list so a lowering that assumed
it was first mis-numbers everything after it.

### The one surviving C defect from the 2026-07-27 adversarial audit

The audit reported 29 findings; its triage adjudicated them to **11 distinct defects** behind a
premise the audit had inverted (it named JS the oracle; D86 says C is the specification). **Ten are
closed** — #1/#2 by D84's injective mangling, #3 by D85's division ruling, #4/#5 by commit `b466f71`
turning six bare emitter throws into located LL0106s, and the NUL, `argv`, cyclic-equality,
division-erasure and stacked-decorator ones below. This one is open, verified in source on
2026-07-28, and was recorded nowhere but the triage until now:

*   ~~**Embedded NUL truncates a string literal, and two strings sharing a NUL prefix compare
    EQUAL.**~~ — **CLOSED**, and it was the one the triage named to fix first. See below.
*   ~~**An under-applied closure reads past `argv`.**~~ — **CLOSED**, and it was worse than recorded:
    a *nullary* dynamic call dereferences a NULL `argv` and SIGSEGVs. See below.
*   ~~**Deep structural equality has no cycle guard and no pointer-identity short-circuit.**~~ —
    the crash is **CLOSED**; whether two *distinct* cyclic values are equal is now an **open
    ruling**, listed below. See both entries.
*   ~~**Stacked `...args` decorators trap** — `TypeError: expected a Vector` on C.~~ — **CLOSED**;
    the fault was in how the inner layer was *called*, not in the layer. See below.
*   ~~**A boxed int `/0` yields `Infinity`** instead of trapping.~~ — **CLOSED**, and the `Infinity`
    was a symptom: the *quotient* was wrong too. See below.
*   **Deep non-tail recursion SIGSEGVs** where JS raises a catchable stack overflow. **Re-measured
    2026-07-30, and NOT fixed on purpose** — it needs a ruling and a cost Sabaka should choose. See
    the entry below.

**And four divergences that need a RULING, not a fix** — in each, C is at least as defensible as JS,
so none should be "corrected" before it is decided:

*   **Are two DISTINCT cyclic values equal?** New, and raised by fixing the crash beside it.
    Co-inductive equality (a memo of the pairs already being compared) answers **yes**, and is what
    Node's `assert.deepStrictEqual` and Python's `==` both do. A depth budget answers **"cannot
    tell"**, which is what ships today. Nothing else in the language has an opinion, and the oracle
    has none either — it exhausts its own call stack on the program. Deciding it is a one-line
    change either way; deciding it *silently* is what the budget exists to avoid.
*   **Non-exhaustive match fall-through.** C traps a typed error; JS propagates **nil** into an
    `Int`- or `String`-typed slot. D9 exists to forbid exactly that in-band lie, so C looks right.
*   **Closure capture of a loop-mutated `mut`.** JS gives `3 3 3` (one shared cell), C gives `0 1 2`
    (per-iteration snapshot). Undecided, and most languages moved toward C's answer.
*   **`Number("")`** — `NaN` on C, `0` on JS. JS's `0` is a known wart, not a specification.
*   **Module initialisation order**, and whether `T | Nil` and `T?` are the same type.

### ~~An embedded NUL truncated a string literal, and NUL-prefixed strings compared EQUAL~~ — **CLOSED**

An l-lang String is a **counted byte range**; a C string is a terminated one. Every literal the C
emitter produced went through `ll_str_lit`, which measures with `strlen`, so the two representations
were being conflated at the exact point where one becomes the other.

**The truncation was the visible half. The equality was the dangerous one.** `ll_str_eq` is
`len == len && memcmp` — correct as written, and correct for the whole life of the backend — but it
was handed two *already truncated* strings, so it answered honestly about the wrong inputs:

| measured | C, before | C, after | JS |
|---|---|---|---|
| `"ab\x00cd".length` | 2 | 5 | 5 |
| `(== "ab\x00cd" "ab\x00XY")` | **true** | false | false |
| `{"k\x001" "one" "k\x002" "two"}` | `two two` | `one two` | `one two` |

That third row was not predicted and is worse than the triage recorded: the two keys did not merely
compare equal, the second `ll_map_set` found the first "equal" and **overwrote** it, so a two-entry
map literal became a one-entry map. A comparison that answers "equal" for unequal inputs is the shape
behind every length-confusion CVE, which is why the triage named this the first of the six to fix.

**The fix is one function and no runtime change.** `cStr()` in `EmitCirToC.ts` states the byte count
at the emission site and calls `ll_str_from`. The escape side was never wrong — `cEscape` writes a
NUL as `\000`, always three octal digits, so a following digit cannot be absorbed into it. Everything
downstream of construction — concat, slice, compare, `.length`, display, `fwrite` — already worked
from `s->len` and needed nothing.

Applied at **all seven** literal-emission sites, including field names and map keys that cannot carry
a NUL today: "which of these can hold user text?" is a question that must be re-answered every time
one of them moves, and answering it wrong is silent.

Guarded by `80-adversarial/nul_in_string.lisp`, which was measured RED first — **9 of its 11 lines
were wrong** before the fix. `ll_str_lit` remains in the runtime for genuine C strings (`argv`,
`getenv`, internal constants); it has no callers in the emitter.

### ~~An under-applied closure read past `argv`~~ — **CLOSED**

`(argc, argv)` is a flat, **unchecked** pair. Arity is checked at compile time wherever the callee is
known — `(g 7)` on a two-parameter `g` is LL0211 — but a callee reached as a *value* has no such
site, and nothing between `ll_call` and the callee compares the count against the arity. All three C
entry points that unpack it read `__argv[i]` unconditionally.

**It was worse than the triage recorded.** The audit had the `#<object>`; it did not have this:

| measured | C, before | C, after | JS |
|---|---|---|---|
| `(f 7)` on `(fn [a b])` | `[7 #<object>]` | `[7 nil]` | `[7 nil]` |
| `(call f)` on `(fn [a b])` | **SIGSEGV, exit 139** | `[nil nil]` | `[nil nil]` |

D1 makes `(f)` a *read* of `f`, so `call` is the only spelling of a no-argument invocation — and
`ll_call_dyn` passes `(0, (ll_value*)0)` for it. `__argv[0]` on a null pointer is not a wrong value,
it is a fault, and the guard file's first line took the whole program down before this landed.

**And one shape looked correct while being undefined.** A top-level function used as a value goes
through an adapter with the same unguarded read, and printed `[7 nil]` — the right answer, because
the stack slot after the caller's one-element compound literal happened to hold zero and `LL_NIL` is
0. Undefined behaviour that agrees with the oracle is still undefined behaviour, which is why all
three sites are fixed and the guard asserts the shapes that were already "passing".

`arg(i)` in `EmitCirToC.ts` is `(__argc > i ? __argv[i] : ll_nil())`. A missing argument binds nil,
matching JS; where the parameter has a concrete C type the unbox then traps ("expected an Int")
rather than computing on garbage. Over-application still drops extras — the guard is `>`, not `==`,
because turning that into a refusal would be a language change nobody ruled. The rest parameter
beside these was **already** clamped against `__argc`; that guard was written for this exact hazard
and then not extended to the fixed parameters next to it.

Cost is one compare per parameter per *dynamic* call; a statically resolved call passes typed C
arguments and never touches argv. Guarded by `80-adversarial/under_applied_closure.lisp`.

### ~~`==` on a value that reaches itself crashed~~ — **CLOSED**, and it raised a ruling

`ll_deep_eq` walked a value graph as if it were a **tree**. The JS shim opens `__ll_deep_eq` with
`if (a === b) return true;`; the C one had no counterpart at all.

| measured | C, before | C, after | JS |
|---|---|---|---|
| `(== a a)`, `a.next == a` | **SIGSEGV, exit 1** | `true` | `true` |
| `(== a b)`, two such | SIGSEGV | catchable `RangeError` | catchable host stack overflow |

**Identity implying equality decides nothing** — it is the one case where the recursive walk is
provably redundant — so that half is a plain fix, `ll_same_ref` ahead of everything else.

**The second row is not an answer and is not meant to be.** Two distinct structures that each reach
themselves have no finite walk, and whether they are *equal* is undecided (see the ruling list
above). A depth budget of 10000 — the recursion is per **level**, not per element, so a
million-element vector is depth 1 — turns an unbounded recursion into a bounded, catchable, located
failure. That is a safety property; it makes no claim about the pair, and swapping it for a
pair-memo later is a one-line change.

**The first spelling of the trap was still uncatchable, which is the part worth remembering.** D82
makes a trap catchable by finding a **class of the kind's name** in the emitted module, and
`ValueError` is not in the ambient tower — so `catch e :of Error` handled it perfectly on JS and it
stayed fatal on C. A fix that trades one uncatchable failure for another is not a fix. `RangeError`
is ambient, and is what the host raises for the same condition, so the backends now fail alike.

Guarded by `80-adversarial/cyclic_equality.lisp`, which asserts the *shape* both backends share
(caught, and execution continues) rather than the message, since those legitimately differ. It also
pins that the short-circuit did not quietly turn `==` into `is`: distinct-but-equal values are still
equal, differing ones still are not, and a finite chain still walks.

### ~~Erasing a type changed the arithmetic — boxed `/` was real division~~ — **CLOSED**

The audit recorded "a boxed int `/0` yields `Infinity` instead of trapping". That is the corner of
this that a zero divisor makes visible. The defect is larger and quieter: **the quotient was wrong.**

`binopMode` returned `"real"` for `/` **before** the boxed-operand check that every other arithmetic
operator makes — so `/` was the one operator that narrowed an Unknown, and it narrowed it
unconditionally to double:

| | statically typed | through an Unknown |
|---|---|---|
| C, before | `(/ 7 2)` → `3` | `(/ 7 2)` → **`3.5`** |
| C, after | `3` | `3` |
| JS | `3` | `3` |

`+`, `-` and `*` beside it already fell to `ll_op_*`, which dispatches on the runtime **tag** and
preserves int-ness. `%` did too, but only when the divisor was non-zero. Routing `/` and `%` through
`ll_idiv`/`ll_imod` — *the same functions the static path calls*, not a copy of their logic — brings
three of D85's guarantees to the boxed path at once: a zero divisor panics, `INT64_MIN / -1` wraps
per D51 rather than being C-undefined, and the quotient is an Int. Real division is untouched,
exactly as D85 scoped it.

**One corpus file went red, and it was right to.** `01-functions/04_pipelines.lisp` advertised
`Pipeline C1 Result (0.25)` from `"hello" |> (fn [s] (return s.length)) |> (/ 10)`. `.length` is an
Int (D52), so under D49d that asks for `5 / 10 == 0` — which is what the **statically typed spelling
has always answered on both backends**. It printed `0.25` only through the pipeline, where the lambda
erases the type. The demonstration there is *pipelines*; the line now says `(/ 10.0)`, which is what
it meant, and matches the file's own `Real`-typed helpers.

**And that is where the JS backend contradicts itself**, which is why the guard is graded on C only:
JS's run-time `.length` is a host **Number** while its own checker types it **Int**, so JS answers
`0` statically and `0.5` erased. Exactly one line of
`80-adversarial/int_division_erasure.lisp` diverges, and the manifest entry names it.

### ~~Stacked `...args` decorators trapped~~ — **CLOSED**

A `[...rest]` parameter is packed **by whoever knows the arity**. A direct call site does, because it
can see how many arguments there are. The boxed convention cannot: `ll_call` hands the callee a flat
`(argc, argv)` and no site in between ever built a vector — so a function with a rest parameter,
reached as a *value*, must collect its own.

The lifted-closure prologue already did that, with a comment saying exactly why. The **top-level
function adapter** did not: it read `__argv[restAt]` as though the vector were already there.

D75 unfolds each decorator layer into an ordinary C function taking one packed `ll_vec*`, and binds
the next layer's `original` as a closure **value**. So the outermost layer is called directly (packed
by its call site, fine) and every layer beneath it goes through the adapter. One decorator worked;
two gave `TypeError: expected a Vector` — **with the outer layer's log line already printed**, which
is the tell that the fault was in the *call*, not in the callee that raised it.

`emitAdapter` now packs `__argv[restAt..]` with the same clamp the closure prologue uses, so an
under-applied call yields an empty rest rather than a negative length. `restAt` reaches it through
the CIR adapter descriptor, from the signature that already recorded it.

**Third instance of one convention being taught a rule while its sibling was not** — the rest clamp
existed in the closure prologue while three fixed-parameter reads beside it trusted `__argc` (fixed
this session), and the packing existed there while the adapter did not.

Guarded by `80-adversarial/stacked_rest_decorators.lisp`: three layers deep (so a fix repairing only
the first hop stops after the second), a fixed-parameter decorator stacked under a rest one (so
"pack everything" would fail), and a nullary under a rest decorator (`__argc == 0`, the clamp's
edge, and the NULL-argv call at the same time). It printed one line before the trap.

### Deep recursion SIGSEGVs — measured, costed, and DELIBERATELY NOT FIXED

The last of the audit's six. It is not left because it is hard to write; it is left because **both of
its answers are Sabaka's**, and shipping either one quietly would be the wrong kind of progress.

**Reproduced 2026-07-30.** `(fn depth [n] (if (== n 0) 0 (+ 1 (depth (- n 1)))))` at `n = 10^7`:

| | C | JS |
|---|---|---|
| output | *nothing* | `caught: Maximum call stack size exceeded`, then `after` |
| exit | 1 (SIGSEGV) | 0 |

**Question one — is stack exhaustion catchable?** JS's answer is yes, but it was inherited from the
host, not designed (D85 makes the same observation about `(/ 1 0)` there). D82 rules that a *data*
error is catchable and a *contract violation* is not, and puts `OutOfMemory` on the fatal side
explicitly, because building the error object allocates the very resource that ran out. Stack
exhaustion is the same shape. So the D82-consistent answer is a **loud, reported panic** — which is a
much smaller change than a catchable one, and diverges from JS on purpose.

**Question two — what does the guard cost?** The obvious implementation is a stack-depth probe at
every user function entry: record the base in `main`, compare `&local` against a limit. Measured with
a C micro-benchmark (`fib(38)`, 5 runs, best of):

| | plain | guarded | overhead |
|---|---|---|---|
| `-O0` | 0.134 s | 0.141 s | **4.8 %** |
| `-O2` | 0.064 s | 0.113 s | **76 %** |

The `-O2` number is the real one and it is not a rounding error: taking the address of a local
**forces a stack frame**, so the guard defeats exactly the leaf-call optimisation that makes small
functions cheap. A 76 % tax on call-heavy code, to catch a case that ends the program either way, is
not a trade to make silently.

**The cheaper design, if the tax is the objection:** guard only functions that can actually recurse.
Direct self-recursion is a one-line check in the emitter (does the body call its own `cName`);
mutual recursion needs a call graph over the module's top-level functions, which the backend already
has the pieces for. Then leaf and iterative code pays nothing. It is more machinery, and it is
**untested against the corpus** — no claim here about how many functions it would cover, because
that number has not been measured.

Nothing about this is blocked. It is written down, costed, and waiting on which answer is wanted.

### ~~Arithmetic is only checked at arity two~~ — **CLOSED (D92)**

`(+ d t x)` printed `114` — 100 metres + 4 seconds + 10 metres, silently — because
`inferOperatorType` branches on arity 1 and 2 and then falls through to `unknown()`, with both D90's
dimension rule and D88's promotion inside the two-operand branch.

**Closed by lowering rather than by patching the checker**: an n-ary operator now left-folds into
binary ones in the desugarer, above the type checker, so every rule written for two operands applies
at every arity by construction. It also closed two silent wrong answers nobody had reported — the JS
shim defined `%`, `<`, `>`, `<=`, `>=`, `==` and `!=` as binary functions that **discarded every
operand past the second**, so `(% 17 10 3)` answered `7` (that is `17 % 10`; a fold is `1`) and
`(< 1 3 2)` answered `true` (that is `1 < 3`). Pinned by `80-adversarial/nary_operator_fold.lisp`.

**The chain half landed too**: `(< a b c)` is `a<b && b<c`, with an impure interior operand bound to
a temporary first, so it is evaluated exactly once (verified: two impure interiors produce two calls,
not four). **Comparisons and `%` across dimensions remain unruled** — that half of the D90 gap is
untouched by this.

### ~~D94's three defects behind "everything is an expression"~~ — **CLOSED**

The claim was stated in `docs/language-syntax.md:18` and `docs/inbox/hir-brief.md:21`, and **D9's
`Void`-is-`Nil` ruling rests on it as a premise**. All three defects are fixed; guarded by
`80-adversarial/statement_value_position.lisp` on both backends, plus three `test:diagnostics` probes.

*   ~~**`for` in value position emitted C that `cc` rejects**~~ — `int64_t` passed where `ll_value` was
    expected, while the same loop in statement position compiled. **The cause was not in the C backend
    at all**: the type checker never walked into a `for` that sits in a `let` init, so the channel had
    no entry for the induction variable, and the emitter fell back to boxed while the init declared
    `int64_t`. Typing the form fixed the emission with no codegen change.
*   ~~**A statement's `nil` was untyped**~~ — `(+ <while-value> 1)` passed the checker and died at run
    time on both backends; `(+ (for :each …) 1)` printed `1`, a **silent wrong answer**. `while`, `for`,
    `for :each` and the assignments now type as `Nil` and the existing **LL0204** refuses them
    (*"Operator '+' is not defined for Nil and Int"*). No new diagnostic was needed.
*   ~~**A named `fn` and every declaration in value position handed the user a Node stack trace**~~ —
    `asExpression`'s bare `throw`, on the argument that reaching it was "not a user-reachable state".
    It was reachable two ways. A named `fn` now emits a `FunctionExpression` and yields the function,
    matching C; a declaration in a value slot is **LL0109** with a location (C refuses it as ELL0106).

**Still open — a `let` in value position.** `(let x (let y 5))` is deliberately untouched: the type
channel's entry for a `VariableNode` is not free, it is the *binding's* type, read back by
`LowerAstToHirVisitor.declaredTypeOf` to decide how the binding is declared in C. Typing the node
`Nil` there would declare every nested `let` as Nil. It still panics at run time.

**Not part of D94, and prior to it: l-lang has no `break` and no `continue`** — not a token, not a
node, not a production. (`examples/03-loops/02_more_for_loops.lisp` defines a *function* named
`continue`.) So "should `break` carry a value" is not the open question; **"should `break` exist"** is.
Whether a loop should yield a **sequence** rather than `nil` — a `for` that collects is a comprehension
— is recorded as open alongside it.

### ~~A closure in a `for`'s `:init` does not capture by reference~~ — **CLOSED (C1)**

**A correction first.** The entry that stood here said *"the closures capture `i` and `j` by value"*,
and that was an inference from the symptom, not a measurement of the mechanism. Capture-by-reference
was never broken: `computeCellVars` has always promoted a mutable-captured local to a heap cell, and a
closure over a `mut` in an ordinary function body has always worked (measured: answers `2`). What
failed was **reaching** that analysis from a `for`. The `c-status.ts` note for `01_for.lisp` had
already diagnosed it exactly — *"the cell analysis does not promote it inside a `for :init` … wants
computeCellVars to see a for-init block"* — and was more accurate than what replaced it.

Three defects, none of them the capture mechanism:

*   **`collectMutDecls` descended only into `list` blocks** while its sibling `collectNestedFreeVars`
    descended generically over every key. So a closure declared in a `for`'s `:init` was seen and the
    `mut` beside it was not, and the intersection of "declared in this frame" and "captured by a nested
    closure" came out empty. The two walkers now share one rule: descend everywhere the **function
    frame** extends, stop at a nested `function`.
*   **At module scope the analysis ran over `topLevelStmtNodes(body)`**, which keeps only
    `opaque-stmt | class | expr-stmt | var-decl` — a top-level `for` is in *none* of those, so the cell
    set was computed over **zero items**. It reads the AST now, the same correction D72's annotation
    registry already carries ten lines above it, against the same silent-scan-at-the-wrong-depth failure.
*   **`EmitCirToC`'s `c-for` update slot hand-rolled the lvalue** as a bare `target.cName`, ignoring the
    `cell` flag its own `lvalue()` helper honours — so a cell was read `(*u_j)` and written `u_j`. A
    second copy of one decision, drifted; unreachable until the first two made cells appear in a `for`.

The ordering half — `init` before `test`/`update` in `ResolveHirToCir` — had to land **with** these and
not before: alone it turns `02_more_for_loops.lisp` from a refusal into an infinite loop, which is why
it was reverted once (D94-a).

**Result: `not-yet` is now ZERO.** `03-loops/01_for.lisp` (which had timed out for the life of the C
backend) and `03-loops/02_more_for_loops.lisp` both pass and are on the allowlist; refusals 5 → 4.
Guarded by `80-adversarial/for_init_capture.lisp`.

**Still open, and acceptable:** `cellVars` is keyed by **mangled name**, not by binding, so two
same-named bindings in one frame share an entry and an uncaptured one can inherit a needless heap cell.
That is a cost, not a wrong answer — but only while the declaration, every read and every write agree,
which is exactly what the third defect above broke. The corpus file pins that case.

### ~~The homoiconicity ruling has no D-number~~ — **CLOSED (D101)**

It had spent a year as a string in `src/test/manifest.ts` — the governing decision for the project's
headline feature, stored in a test ledger. **D101** gives it a number, and D95 is why it needed one
now: `defsyntax` receives the AST datum and `defmacro` is specified to receive *a cons list of
tokens*, so "cons/list is a derived layer" had to say which cons list it meant.

**Three representations, and only naming them keeps the tiers honest**: the AST datum (built, both
backends), the cons *view* of it (derivable today as a library), and a *token* list (not built; a
different object at a different stage). A token list is not the cons view with the parser removed.

**Derived is now demonstrated rather than asserted.** `80-adversarial/cons_view.lisp` builds
`["+" 1 2]` — the exact shape `00_quoting.lisp` has asked for since it was written — in twenty lines
of l-lang over quote's datum and the generated schema, with no compiler change. And genericly: the
walk is driven by `child-fields-of`, so the nested `if` is special-cased nowhere. That is what M2's
schema was generated for, two phases before anything needed it.

**Still missing: the return trip.** `(eval x)` is LL0236 on both backends.

### ~~`quote` has no C lowering~~ — **CLOSED (M1)**, and homoiconicity's return trip is what is left

`'form` was `ELL0106 special:quote, no lowering exists` on the **reference** backend (D86), so the
language's headline feature existed only on the deprecated oracle — and because
`12-quote-macros/00_quoting.lisp` is `xfail` and was never in `c-status.ts`, nothing measured the gap.

The lowering is `JSTransformerAstVisitor.dataToESTree`'s twin, and has to be: both backends are graded
against one golden. Three lines of contract — an array becomes a vector, an object becomes a map keyed
by its own fields minus `_location` and `_parent`, everything else is its literal. No new emitter
machinery: `c-map` and `c-vector` already existed and `EmitCirToC` already builds this exact shape for
the `__ll_meta` graph (D70). Guarded by `80-adversarial/quote_datum.lisp`, which pins the **contract**
(reachable by name and index, `_type` is the node's own, Int stays Int) rather than the serialisation,
whose field order is `AstBuilder.makeNode`'s insertion order and is nobody's ruling.

`00_quoting.lisp` now reports the **same diagnostic at the same location on both backends** — `LL0236`,
`eval` — where C used to refuse at quote before ever reaching it.

**What is left is the return trip, and one unruled decision.** `eval` needs a runtime AST interpreter
(LL0236). And the governing homoiconicity ruling — *"BOTH, with the AST datum as the source of truth
and cons/list a derived layer"*, taken 2026-07-22 — **still has no D-number**; it lives in a string in
`manifest.ts`. D95 raised its stakes: with `defmacro` receiving tokens and `defsyntax` receiving an
AST, that ruling now has to say how the two views relate.

### The AST schema is in the stdlib and generated — **M2**

`lib/std/llang/ast.lisp` mirrors `src/compiler/frontend/ast.ts` — **86 node kinds**, their declared
fields, and which of those fields hold child nodes. Emitted by `npm run ast:stdlib`, and
`npm run test:docs` regenerates and diffs it, so a kind added to the compiler while the l-lang-side
mirror still describes the old set turns the build red. Same gate the EBNF grammar already had, against
the same failure: a mirror that lies.

**It declares no field accessors, deliberately.** A quoted form is a map (D3d) and `n.nodes` already
reads it — and that read is already *total*, since an absent field answers nil rather than raising
(measured, both backends). Eighty generated accessors over a working syntax would be ceremony.
`std/llang/reflect` needs its accessors because a reflection descriptor's shape varies by kind and
`t["extends"]` on a root class really does raise; the argument does not transfer. What the module adds
is what member access cannot tell you — `kinds`, `fields-of`, and `child-fields-of`, the last of which
is what a generic walker follows and nothing in l-lang could derive before.

One heuristic, stated because it is where this can silently go stale: a field is child-bearing if its
declared type mentions a node-bearing name, resolved through type aliases to a fixed point (which is
what makes `BindingTarget = IdentifierNode | VectorPatternNode | MapPatternNode` come out right).

### The comptime evaluator holds an AST — **M3**

`CTValue` ran `bigint | number | string | boolean | null | CTValue[]` — scalars and arrays — so the
interpreter could not hold a form even in principle, and D69's `defsyntax` ("receives a full AST")
could not have been written in it at any price. It now includes `ast.ASTNode`, `quote` evaluates to its
un-evaluated operand, and dotted reads and indexing work over a form.

**A quoted form is a compile-time constant on LL0099's own terms, not as an exception to it.** That
rule exists because the interpreter models no runtime state: every evaluation must start from something
already finished. A quoted form is already finished — more so than `3`, which at least had to be
produced — because quote's whole semantics is that its operand is not evaluated. So the subset stays
*"every evaluation starts from constants and ends in one"*, which is what the interpreter's own header
credits for making it tractable.

**The tier boundary is enforced rather than assumed.** A `:comptime` fold whose result is a form
re-wraps it in `quote` and keeps it as *data*. Splicing a returned form into the tree is macro
**expansion** — `defsyntax`'s job — and `:comptime` doing it by accident would collapse two of D69's
three tiers with nobody ruling it.

Field reads are **total** (an absent field is nil, matching what both backends already do for the same
read), and `_parent` is refused: it is cyclic, and reading it would let a handler walk out of its own
form into the enclosing program. Both refusals pinned in `test:diagnostics`; guarded end-to-end by
`80-adversarial/comptime_form.lisp`, whose every line folds to a literal before codegen.

### ~~A module-level `map` literal in an IMPORTED module has no C lowering~~ — **CLOSED**

`resolveAstExpr` had a `vector` case and **no `map` case at all**. Every path that re-drives raw AST
therefore refused `ELL0106 'map': no lowering exists` — and an imported binding's initializer is
resolved from the AST rather than the HIR, which is why a map literal that compiles perfectly inside a
function body failed at module scope in another file.

**Two open reports were the same missing switch case.** The other was D75's decorator **setup slot**,
whose `(let cache {})` is resolved the same way (see below). Neither report mentioned the other, and
neither named `resolveAstExpr`.

Guarded by `test:imports` **S15.4**, which checks a vector in the same fixture — so the entry says
"maps specifically", not "module-level literals in general", and can be falsified.

**A THIRD report was the same case**, found afterwards by re-measuring a note that said a class field
could not default to a map literal while a vector default was fine. It could not, for this reason, and
now can — `80-adversarial/decorator_module_scope.lisp` carries the only guard for it.

### ~~A decorator's wrapper cannot read a module-level binding~~ — **CLOSED**

`computeGlobals` hoists every module-level binding a top-level function reads into a file-scope global,
because a C function cannot see `main`'s locals — the JS backend closes over module scope for free. It
scanned `items` for `_type === "function"`, and **a `defmodifier` is not one**: it is a `modifier-def`
*holding* a function, which D75 then unfolds into a top-level C function.

So a decorator that read a module-level `let` emitted `cc: error: use of undeclared identifier
'u_prefix'`, and was correct on JS. The workaround on record was *"call a top-level function instead —
one hop is the whole fix"*, which is true and turned out to be unnecessary: the scan was simply not
looking in the one place D75 puts a function body.

M2's schema was written as `match` arms returning vector literals to work around this. That workaround
is no longer forced; it is left alone because rewriting a generated file to prove a point is not worth
a re-generation.

### ~~D75's decorator SETUP slot has no C lowering~~ — **CLOSED**

`(defmodifier memoized [] (let cache {}) (fn [original n] …))` — the setup slot runs **once, at
decoration time**, which is the whole reason it exists: a decorator with no decoration-time state is
just a function. C refused it by name (`ELL0106 decorator-setup:memoized`), correctly, because
dropping it silently would give every call a fresh cache — a memoizer that memoizes nothing while
appearing to work.

A layer unfolds into an ordinary top-level C function (D75) and a C function cannot see `main`'s
locals, so each setup binding becomes a **file-scope global** initialised before the module body runs
— the same obstruction `computeGlobals` solves for module-level bindings.

**Keyed by LAYER, not by modifier**, and that is the part that needed a guard: `:memoized` on two
functions must get two caches. Keyed by modifier they would share one, and since the key is the
argument, `(cube 3)` would answer `9` — the square's cached result, silently, and only for arguments
both functions happen to have seen. `80-adversarial/decorator_setup_state.lisp` calls both with the
same argument, which is the only way that collision is observable.

**Only a reference-typed binding is accepted; the rest refuses by name.** The prologue binds the
source name by copying the global, which shares the pointee for a vec/map/obj and would *not* share an
`int` — so `(mut count 0)` in a setup slot would reset every call, silently. That is the exact failure
this feature exists to prevent, so it refuses (`decorator-setup-not-shared:count:int`). Making it work
needs the binding to be a heap cell (the C2 machinery); the only setup slot in the whole tree today is
`(let cache {})`.

**And writing the guard found a D83 bug one line up.** `decoratorShape` split `def.body` positionally
without filtering comments, so a trailing `;;` made the last element a comment and refused the whole
decorator as mis-shaped, while one earlier arrived in `setup` as a statement to hoist. *A comment
occupies no slot* — filtered now, for the same reason `listForm.listNodes` filters.

`10-modifiers/05_multiple_modifiers.lisp` moves from **refused to passing**, graded against the same
golden JS uses, cache hit and all.

### ~~A nested `:gen` has no C lowering~~ — **CLOSED (C2)**

A top-level `:gen` has compiled since D58; a nested or lambda one was `ELL0105`, so laziness existed
only at module scope on the **reference** backend while JS had it everywhere. That is what made "a loop
yields a sequence" unbuildable: a loop lives inside a function, so its generator is nested by
construction.

**The obstruction was storage, not control flow.** A generator frame is `ll_obj.fields[]` — a flexible
array of `ll_value`, uniformly boxed by construction — while a mutable capture was a bare `ll_value*`
heap cell, and the value union has no pointer arm. A captured `mut` could not go in a frame slot at all.

**A cell is a one-field OBJECT now**, so it boxes into a slot like anything else and the value union is
untouched. The alternative — an 11th tag on `ll_value` — would have put a user-invisible arm through 47
`case LL_` sites, equality, copy and display, for something that must never be observed. The migration
is transparent: the corpus, `test:codegen` and `test:memory` were all unmoved by it.

The rest fell out of a ruling already in place: `promoteFrame` promotes every param and local to a frame
slot ("promote everything", D58), so a capture is just another slot and the state machine needed no
special case. Frame slots holding a cell carry a `cell` flag so reads and writes deref through it —
without that the generator mutates its own copy, which is the by-value failure C1 chased.

`:async` stays refused by ruling (D60). Guarded by `80-adversarial/nested_generator.lisp`.

### ~~C3 — loops yield a lazy sequence~~ — **CLOSED (D100)**

`(let ys (for :each x :from xs :then (* x 2)))` binds a lazy sequence. One iteration yields its BODY's
value; a loop in statement position is untouched and keeps D94's `nil`.

**Elision is not an optimisation, it is the scope.** 367 loops across corpus and stdlib, 3 in value
position — only a loop whose value is *bound* is rewritten at all, so the other 364 emit what they did
before.

**The placement was the whole problem, and D95 had already ruled it.** The rewrite INTRODUCES a `:gen`
declaration, and the symbol table is built one stage later; put in the desugarer it failed with
`LL0210 '__ll_seq_0' is not defined`. It runs at D95's pre-symbols seam, for D95's reason.

Two shapes the source does not show had to be handled: **two layers of list-wrapping** (the statement
*and* the value), and a **C-style `for` rotated into a `while`**, because its `:step` cannot survive a
coroutine split in a C `for(...)` update slot. Only possible because **C2** made a nested `:gen` lower.

**Still D94's `nil`:** a loop as a call argument or `return` operand. `(+ (while …) 1)` is still
LL0204. That line is an increment, not a principle.

### ~~A nested closure in a PIPELINE HEAD is not called on C~~ — **CLOSED**

The diagnosis in the previous entry was right and the location was one level off. It is D1's rule —
`(f)` is a call iff `f` names a function — and the rule was stated **three times**, with one of them
asking a different question:

| site | question it asked | |
|---|---|---|
| `classifyCall.isFunction` | is the name declared a function / typed as one? | correct |
| `resolveFreeCall`, local arm | *(calls through the closure at any arity)* | correct |
| `resolveCall`, local arm | **is it a LOCAL?** → read, for every local | wrong |

The third only runs where the HIR left a raw list for the backend to re-drive — and **a pipeline head
is exactly that**. `((mk) |> f)` desugars to a core `call` node whose *argument* is the untouched list
`(mk)`, so the head was classified by the out-of-step rule: a top-level `mk` took the
top-level-function branch and called, a nested one took the local branch and yielded the closure.

Measured on the same program twice: top-level `mk` → `3`; nested `mk` → `ELL0106 cast:closure->vec`
where the stage was typed, and `TypeError: expected a number` at run time where it was not. Correct on
JS throughout, so it was a backend divergence as well as a defect.

The fix is gated on the local's C type being a **closure** — the only form of "is a function" that
survives to that point. A boxed local that *might* hold one at run time stays a read, because
narrowing it would be a guess and D1's read is the answer when the question cannot be settled
statically. Guarded by `80-adversarial/pipeline_head_closure.lisp`, which pins that other half too.

**`nested_generator.lisp` was written around this** — it uses the raw `iter`/`next` cursor and says
why. That comment is now describing a closed defect rather than a live one.

### ~~A nested `fn` inside a generator emits invalid C~~ — **CLOSED**

It did not merely fail to name a variable: the nested function **lost its own body**. `inGenerator`
is a flag on the resolver, but it describes the function being resolved, so a lifted helper inherited
it and its `return` was rewritten into the enclosing generator's park-and-answer-nil epilogue
(D31/D58). `(fn dbl [x <- Int] -> Int (return (* x 2)))` emitted `__ll_gen_state = -1; return
ll_nil();` as its entire body — naming a frame slot that exists only in the generator's step
function, so the C would not compile. Had it compiled, `dbl` would have answered nil instead of 8.

**Two copies of one save/reset list, both missing the same field.** `isolated()` resets what a C
function must not inherit (scopes, cellVars, inFunctionBody, selfClass); the lambda lifter keeps an
inline duplicate of that list. Neither had `inGenerator`. Fixing `isolated()` alone left the program
broken — measured — because a nested `fn` is lifted and never reaches it. Pinned by
`80-adversarial/nested_fn_inside_generator.lisp`, whose last row is the control: the generator's own
`return` must still end the sequence.

### ~~No rewriting pass reached inside a catch arm, a restart arm or a handler clause~~ — **CLOSED**

**D89's bug, one container over.** That note records a matrix ROW being `ASTNode[]` inside
`ASTNode[][]` — not an AST node, so it came back untouched and no rewrite ever reached a matrix cell.
The same sentence was true of a catch arm: `TryCatchNode.catch` is `TryCatchFilter[]` and each element
is a plain `{filter, body}` RECORD, so `mapChildArray` returned it unchanged. Every rewriting visitor
in the tree routes through that one function, so every rewrite stopped at the arm boundary.

Three independent passes, three symptoms, all inside a catch arm, all agreeing on both backends, and
every one correct in the try BODY beside it:

| what | inside an arm, before |
|---|---|
| a `defsyntax` macro | `LL0210 '<name>' is not defined` |
| `(and a b)` | `LL0210 'and' is not defined` — D89's own symptom, verbatim |
| `1/2` | `ELL0106 Cannot generate C for 'fraction-number'` — a raw literal reaching codegen |

Reading passes were never affected (`BaseAstTreeWalker` recurses structurally), which is why an
undefined name inside an arm is reported at all — the same "two halves of the compiler disagreed
about whether this had children" split D89 names.

Fixed by teaching the descent to enter plain records, D89-consistently. **The corpus moved by zero**:
321 passing before and after the behaviour change, because no file had ever written any of the three
inside an arm. Pinned by `80-adversarial/rewrites_reach_catch_arms.lisp` (both backends) and
`rewrites_reach_restart_arms.lisp` (C-native; `RestartArm` and `HandleClause` hold `body: ASTNode[]`
rather than a nested record and reach a different branch).

### A modifier on a METHOD is SILENTLY IGNORED — accepted, undiagnosed, and does nothing

**The worst class in this project's taxonomy: both backends agree and both are wrong**, so the
differential that surfaced ~17-20 C defects is structurally blind to it. One modifier, two positions:

```lisp
(defmodifier dbl [] (fn [original ...args] (* (original ...args) 2)))
(fn :dbl free [x <- Int] -> Int (+ x 1))              ;; (4+1)*2 -> 10   correct
(defclass P (mut :ctor n <- Int)
    (fn :dbl meth [] -> Int this.n)                    ;; expect 10 -> got 5
    (fn :dbl meth-arg [k <- Int] -> Int (+ this.n k))) ;; expect 12 -> got 6
```

No diagnostic on either backend. The user writes a decorator and gets silence.

**D75's own reasoning says a method decoration SHOULD work.** LL0036 refuses a decorator "applied
with a non-constant argument, or inside a function body", because "a decoration inside a function
body is a NEW decoration on every call, each needing its own setup state". A method *declaration* is
not inside a function body — it is a static declaration in a class, exactly as compile-time-known as
a free function's. So this is a gap, not a ruled refusal, and the current behaviour is neither.

**Not fixed here** because decoration is applied SEPARATELY IN EACH BACKEND — `JSTransformerAstVisitor`
for JS, the resolver/emitter pair for C — so implementing it means teaching two method-emission paths
one rule, which is this project's failure mode #2 by construction. And whether a method may carry a
decorator at all is a D75 clarification. At minimum the silence should become a diagnostic: a clean
refusal beats a wrong answer, and today it is neither.

### A decorated SELF-RECURSIVE function emits C that will not compile

```lisp
(defmodifier dbl [] (fn [original ...args] (* (original ...args) 2)))
(fn :dbl countdown [n <- Int] -> Int (if (<= n 0) 0 (countdown (- n 1))))
```

C: `error: incompatible integer to pointer conversion passing 'long long' to parameter of type
'll_vec *'` — the self-call is routed to the decorated wrapper, whose C signature takes the `...args`
REST VECTOR, with the raw `int64_t` argument. JS runs it.

**Bounded**: it is self-recursion specifically. A decorated function calling a *different* decorated
function is correct on both backends (8), and undecorated recursion is correct on both (0). Only the
self-call breaks.

**And the SEMANTICS are unpinned, which is the part that needs a ruling before the fix.** JS re-enters
the decorator on a self-call — `(fn :dbl fact ...)` answers 48 for `fact 3`, which is `6 * 2^3`, one
doubling per level. That is Python's behaviour and follows from rebinding the name to the wrapper. The
other reading — a self-call means the original, so the decorator applies once at the boundary — is
equally defensible and is what a reader of the C signature would expect. D75 does not say. Fixing the
emission without ruling the semantics would freeze whichever answer fell out.

### A METHOD cannot be a `:gen` on C — so the idiomatic `Iterable` cannot be written

The shape `std/protocols`' `Iterable<T>` invites — the required `iterator` method *being* the
generator — is refused by the reference backend:

```lisp
(defclass Range :implements Iterable<Int>
    (mut :ctor hi <- Int)
    (fn :gen iterator [] -> Iterator<Int> (
        (mut i 0)
        (while (< i this.hi) ((i := (+ i 1)) (yield i))))))
```

`ELL0105`. So a class that wants to be iterable must keep its cursor in a *separate top-level*
generator and have `iterator` return a call to it — the protocol is satisfiable, but not in the form
its own signature suggests. This is the mandate's protocol axis: the protocol exists, is in
`std/protocols` (D107), and is conformance-checked (`:of Iterable` answers true, pinned by
`80-adversarial/interface_conformance_of.lisp`) — what is missing is the natural way to implement it.

**The diagnostic's own text is now partly FALSE, which is the second half of this finding.** LL0105
says "a nested or lambda generator has no lowering yet (spec A8)". Measured today:

| shape | C |
|---|---|
| a top-level `:gen` | works (D58) |
| a `:gen` NESTED inside a plain function | **works** — C2 closed this, the message never caught up |
| a `:gen` LAMBDA | `ELL0105` |
| a `:gen` METHOD | `ELL0105` |

So the message tells a user that a nested generator is unsupported when it is supported, and does not
mention the method case at all — which is the one a protocol implementation actually hits. Correcting
the text is small and separable from closing the gap.

### A BOUND loop's type is `nil` in the checker and an `Iterator<T>` at runtime — D100 vs the checker

**The sharpest of the untyped-form family, because it is not a hole but a disagreement.** D100 rules
that a loop bound to a name becomes a lazy sequence while a loop in statement position still yields
nil. `InferTypesAstVisitor`'s `case "while": case "for":` types **every** loop `nil`, with no
value-versus-statement distinction, so the bound half of D100 is unrepresented in the type system.

Measured — the same binding accepts two incompatible annotations, and one of them is a lie:

```lisp
(let s <- Int           (while (< i 3) ((i := (+ i 1)) i)))   ;; accepted
(let s <- Iterator<Int> (while (< i 3) ((i := (+ i 1)) i)))   ;; accepted
```

The runtime agrees with the second: draining `s` sums to 6. Using the first is where it lands —
`(+ s 1)` after the `<- Int` annotation gives **`TypeError: expected a number` on C** (a trap, honest)
and **`[object Generator]1` on JS** (a silent wrong answer). `LL0200` is exactly the diagnostic that
should have fired at compile time, and it is the annotation check that never looked.

**Not fixed here, deliberately.** The fix needs the checker to know value-versus-statement position —
the distinction `isValueTail` already draws in the desugarer — and 364 of 367 corpus loops are
statements, so typing them differently has a blast radius across the whole corpus. D100's own text
warns that the statement case must stay nil "because rewriting them all into coroutines would
allocate frames nobody asked for", and getting the split wrong in the checker is the same mistake
one layer up. Its own round, with the corpus measured before and after.

D100's *runtime* halves are already pinned by `80-adversarial/loop_sequence.lisp` and
`statement_value_position.lisp`; what neither pins is the type, and pinning today's answer would pin
the bug.

### `restart-case` yields a value and the checker does not type it — the sixth instance

`(let a <- String (restart-case ((return (f))) (:sub [v] v)))` where `f -> Int` is **silent**, while
the same annotation over a plain call is `LL0200`. After `if`'s condition, `match`'s arms, `try`
(D110), `when` and `cond` (D112), and `quote` (D113), this is the sixth form found by asking one
question of a different construct.

It yields, measurably: `(let x (restart-case (7) (:sub [v] v)))` is **7** from the body, and **42**
when a handler invokes `:sub 42` — the arm's value substitutes for the whole form.

Unlike the earlier five this one is **deliberate, and its reason has expired**. The visitor groups
`restart-case` with `try-catch`/`handle`/`signal`/`invoke-restart` and comments that the value "stays
Unknown (these forms have no join to compute yet, and JS refuses the D47 four anyway)". There is a
join now and it is the same one D110 and D112 already compute: the body's tail type unioned with each
restart arm's type. `try` was in that same group and was lifted out of it by D110, which is the
precedent. The JS half of the reason is irrelevant to a C-native form under D86.

Tractable — smaller than the loop entry above — but it is a ruling about what a D47 form's static
type IS, and D47 is Sabaka's design; recorded rather than assumed.

### There is NO loop early-exit in the language — `return` is the only way out

Not a defect; an open design question, recorded because it was measured rather than assumed.
`npm run grammar:ebnf` has **zero** occurrences of `break` or `continue`, and the three `(continue`
call sites in the corpus (`03-loops/02_more_for_loops.lisp`) are a **user-defined function of that
name** used as a `:cond`, not a keyword. `(break)` is `ELL0210 'break' is not defined` — an honest
undefined identifier on both backends.

**The consequences are narrow but real.** A loop cannot be left early at module top level at all,
because there is no enclosing function to `return` from; and the inner of two nested loops cannot be
left without a flag in the outer condition, since `return` exits the whole function.

**The mitigating half was measured and is clean**: `return` as a loop exit is correct through every
protected-region combination tried — out of `while`, `for`, `for :each`, and a `for :each` over a
generator; out of a loop inside a `try`, a loop inside a `try` with a `finally`, a `try` inside a
loop, and a `try` inside a loop inside a `try`. All twelve agree on both backends, which matters
because each one has to pop `ll_handler_top` on the way out; a leak there would be silent corruption
rather than a crash.

So the question for a D-number is whether the absence is a deliberate minimalism (a `while` with a
compound condition expresses it, and D100's loop-as-sequence direction may prefer `take-while`) or a
gap to close. Not invented here either way.

### A function nested in a METHOD that references `this` emits invalid C

```lisp
(defclass Counter
    (mut :ctor n <- Int)
    (fn bump-all [xs <- Any] -> Int (
        (mut total 0)
        (let add (fn [x <- Int] -> Void (total := (+ total (+ x this.n)))))
        (for :each x :from xs :then (add x))
        (return total))))
```

C: `error: use of undeclared identifier '__self'`. JS: `36`, correct. Ordinary OOP code, and it does
not build on the reference backend.

**Bounded by measurement, and the boundary is exactly "is the function LIFTED?"** — `this` inside a
method is correct in every ordinary form, and fails only where a nested function is lifted to a
separate C function:

| `this` used inside… | C | JS |
|---|---|---|
| the method body directly | `5` | `5` |
| a `while`, a `for :each` | `15`, `13` | same |
| a `try` body **and** its catch arm | `10` | `10` |
| a `match` arm, a `cond` clause | `5`, `5` | same |
| an f-string — `f"n={(this.n)}"` | `n=5` | `n=5` |
| another method call — `(this.helper)` | `10` | `10` |
| a `restart-case` body **and** its restart arm | `15` | (LL0108, C-native) |
| **a lambda** | **invalid C** | `6` |
| **a nested named `fn`** | **invalid C** | `5` |

The last two reach the same lambda lifter, so it is one defect, not two — and the eight rows above
them show the receiver is otherwise threaded correctly everywhere, including through both longjmp
families.

**Found by the sibling check on the `inGenerator` fix**, not by a separate hunt. That fix aligned the
two copies of the "state a C function must not inherit" list on `inGenerator` — and the copies still
diverge on ONE field: `isolated()` resets `selfClass`, the lifter's inline duplicate does not. This is
what that divergence costs. The leak makes the resolver emit `__self` references into a lifted
function that has no `__self` parameter.

**Not fixed here because the fix is not a flag reset.** Clearing `selfClass` in the lifter would turn
invalid C into an unresolved name — the same program failing differently. The real fix is to CAPTURE
the receiver: add `__self` to the lifter's `captures`/env struct (it already builds both) and route
`this` inside a lifted body through that env field, which is what the JS backend effectively does and
what a user expects. That touches capture detection (`freeVariables` and the modeled D48/Q3 capture
set list names, and `this` is an implicit receiver rather than a named free variable), the env struct,
and the `this` resolution path — a round of its own.

### D9's narrowing does NOT reach a `T | Nil` — so D110's optional `try` cannot be opened

**The sharpest consequence yet of the parked `T?` vs `T | Nil` question, and it makes a shipped
feature hollow.** D110 rules that `(try e)` with no catch yields `T | Nil`, which is the type Sabaka
asked for by name. But the same `(!= x nil)` guard that narrows a declared `Int?` does **not** narrow
that union, so the value can be tested and never used. One probe, two spellings of one type:

```lisp
(let a (maybe 10))                    ;; maybe -> Int?
(if (!= a nil) (twice a))             ;; "T? narrows: 20"
(let b (try (risky 10)))              ;; D110 -- Int | Nil
(if (!= b nil) (twice b))             ;; ELL0203 Argument 1 of 'twice'
```

Measured on **both** backends, in three positions that agree: a call argument (`LL0203`), a `return`
(`LL0213 declares it returns Int, but returns Int | Nil`) and a `yield` (`LL0225 produces Int, but
yields Int | Nil`). So it is not a `yield` hole and not a C hole — the narrowing simply keys on the
`optional` spelling.

**Not fixed, because the fix IS the parked ruling.** "`(!= x nil)` narrows any type admitting nil"
reads like a completion of D9 rather than a new rule, but whether `T?` and `T | Nil` are one type is
exactly the open question, and answering it sideways in a narrowing pass is how a language grows a
surface nobody agreed to. `80-adversarial/try_inside_generator.lisp:60` carries the row that would
pin it and states why it does not.

### ~~A `for :init/:cond/:step` containing a `yield` CRASHES the C emitter~~ — **CLOSED (D116)**, but an INDEX `:step` still crashes

The generator half is fixed: frame promotion turns a `:step` assignment into a **field** store, and
the update arm now admits that kind. `80-adversarial/for_loop_inside_generator.lisp` pins it.

**What remains is not about generators at all.** The same uncaught `Error: C emit: for update must be
an expression or a simple assignment` (`EmitCirToC.ts`) still fires for an INDEX store in a `:step` —
ordinary l-lang with no `:gen` anywhere:

```lisp
(mut v [0 0])
(for :init (mut i 0) :cond (< i 3) :step (v[0] := (+ v[0] 1)) :then (i := (+ i 1)))
```

C: a Node stack trace and a non-zero exit. JS: `index step: [3 0]`, correct. Same for a `map` store
and a `dyn-field` store.

**Why those three were not widened with `field`.** An update clause must be ONE expression, so it
cannot use the temp that `emitStmt`'s `c-assign` arm interposes — and that temp is not decoration: it
stops a slot address being taken before a right-hand side that may `realloc` the storage it points
into, which is memory corruption this project has already paid for once (the comment at that site
records it). A `field` renders as `(obj)->fields[n]`, a fixed slot in an object that never grows, so
there is nothing to invalidate. `ll_index_slot`, `ll_map_slot` and `ll_member_slot` all hand back a
pointer INTO growable storage.

**The shape that would close it** is a runtime store *helper* rather than a slot pointer — a call is
an expression, and all its arguments are fully evaluated before the store inside it happens, which is
exactly the ordering the temp buys. `ll_map_set` already exists; `ll_index_set` and a member
equivalent do not. Until then the failure is a CRASH rather than a refusal, which is the worse of the
two: at minimum it should be an `LL01xx` diagnostic (the codegen band had 10 taken when this was
written; `npm run test:diagnostics` prints the allocator and the next free code).

### An l-lang comment containing `*/` emits invalid JavaScript

`;; a comment containing */ a block-comment terminator` compiles and runs on C and is **LL0101** on JS
(*"the JS backend emitted code that is not valid JavaScript"*). Comments are re-emitted into a JS block
comment, and a `*/` in the text closes it early. Found by writing an adversarial example whose header
quoted C source. Deprecated-backend only, and the diagnostic is honest rather than silent, so it is
recorded rather than fixed.

### Both metaprogramming tiers are BUILT (D95-a, D96, D102)

The tier exists: `DefSyntaxKw`, a production, a node, and an expansion stage between parse and syntax.
A handler receives the argument FORM unevaluated — `unless` places its body in a branch that does not
run, and the corpus asserts the side-effect counter stays `0`. Templates are built with D96's
quasiquote. Five refusals (LL0038–LL0042) plus D96's LL0110, all probed.

**`defmacro` is built too (D102)** — the token tier, between lex and parse. It is the only tier that
can introduce **surface**: D95 measured that 23 of 28 keyword-headed productions have a spelling no
user-defined head can reproduce, and a `:then` clause that is a parse error for `defsyntax` works for
`defmacro`, because the expansion runs before the parser has an opinion.

A handler receives a vector of token **images** and returns one — D101's third representation, kept
deliberately plain so it needs no new value kind. The evaluator gained `head`/`tail`/`empty`/`list`/
`get`, which are the floor's own entries: a handler that can index a vector but not build one is not a
macro. LL0023 is re-aimed rather than retired — it now names a `defmacro` the expander could not
*read*, which is still reachable and is what `(defmacro)` produces.

**Not claimed: hygiene.** A template that introduced a binding could capture one at the use site.
Nothing prevents it and the corpus does not pretend otherwise.

### `for` need not be a built-in — demonstrated (D102's payoff)

`80-adversarial/for_as_macro.lisp` defines `for` as a **user macro**, with its real
`:init/:cond/:step/:then` surface, in five lines:

```lisp
(defmacro my-for [ki ini kc tst ks stp kt bod]
    (list "(" "(" ini ")" "(" "while" tst "(" bod stp ")" ")" ")"))
```

The identity is the one C3's hand-written proof used: `for (init; test; step) body` ≡
`{ init; while (test) { body; step } }`. Nothing downstream knows `my-for` existed — it expands to a
block and a `while` before the parser runs, so types, the HIR and both backends see code they already
understood.

**It is `defmacro`, not `defsyntax`, and that is the measurement.** `:keyword` clauses are welded to
heads the grammar already knows, so a `defsyntax` call site would have to parse *before* it could
expand, and `(u c :then b)` does not — `Expecting token of type --> RParen`. The token tier runs
before the parser has an opinion; that is the one thing it buys.

**What this does NOT do** is retire the built-in `for`. Migrating it for real means the clause surface
below, plus deciding what happens to `for :each` (which `std/iter`'s `Iterable` defines, D30/D31) and
to `:else`. This is an existence proof that the weakest construct in the language *could* be a library,
not a decision that it becomes one.

### The clause surface — measured, and NOT one production change (D95, still deferred)

`(head :kw expr …)` on any head is what would let the other 23 keyword-headed forms migrate onto
`defsyntax`. **Probed 2026-07-29 and reverted.**

*   **The grammar half is trivial and works.** Five lines — `MANY2(ModKeyword expression)` after the
    `..` option. Chevrotain accepts it with no ambiguity error, `(myform :then 1)` parses, the `:of`
    guard still resolves, corpus stays 289/0.
*   **The builder half is the whole job, and without it the change is a silent-wrong-answer
    generator.** `LLangAstBuilder.list` has nowhere to put a clause, so it drops the keyword and merges
    the operand into the argument list: `(f :then 7)` returns **70**, byte-identical to `(f 7)`. The
    `:then` is gone and nothing says so.

Doing it properly means carrying clauses into the AST, teaching every list consumer (`classifyList`,
the checker, the HIR, both codegens) what a clause-bearing list is, and deciding how a `defsyntax`
handler *receives* named clauses — its parameters bind positionally today, and that is an unanswered
design question, not an implementation detail.

**The pressure is off**: D102's `defmacro` can already spell these surfaces, because it runs before the
parser has an opinion.

#### Scoped 2026-07-30 — the numbers the ruling needs, and NO ruling taken

This is a measurement, not a decision. The deferred question is Sabaka's; what was missing was the
cost of each answer.

**The surface, counted.** 16 `*ModKw` clause markers are lexed and **18 productions** consume them:

| marker | consumed by |
|---|---|
| `:cond` `:then` | `condCase`, `forClause`, `ifExpr`, `whenExpr`, `whileExpr` |
| `:else` | `condCase`, `forClause`, `ifExpr` |
| `:each` `:from` `:init` | `forClause` |
| `:step` | `forClause`, `keyValue` |
| `:of` | `catchFilter`, **`list`**, `spreadExpr`, `typePattern` |
| `:extends` `:implements` | `classDecl`, `structDecl`, `interfaceDecl` |
| `:as` `:on` `:satisfies` `:when` | `exportAlias`/`symbolAlias`, `handleClause`, `typeDefDecl`, `matchCase` |

**The precedent is already in `list`, and it is the wrong shape.** The generic list rule carries two
optional trailing constructs — `:of T` and `.. hi` — so "a list may end in a keyword thing" is not new.
But **both change the node's KIND**: `:of` returns a `type-guard`, `..` returns a desugared `Range`
construction. Neither is *carried on* a list. That is exactly what "the builder has nowhere to put it"
means, and it is why the 2026-07-29 probe's five grammar lines produced a silent drop.

**The consumer count is 50, not 110.** There are 110 raw `.nodes` reads outside the frontend, but the
number that matters is the **50 sites in 12 files** that dispatch on list-ness (`case "list"`,
`_type === "list"`, `isListNode`) — 20 of them in `InferTypesAstVisitor` alone.

**Three answers, and what each costs:**

*   **(a) An optional `clauses?` field on `ListNode`** — cheapest, and follows `ForNode.duplicateClauses`'
    precedent of "present only when relevant". **All 50 sites ignore it by construction**, silently.
    This is the silent-wrong-answer generator the probe hit, restated: nothing forces a consumer to
    notice a field it never reads.
*   **(b) Desugar clauses away in the builder**, so no consumer sees them. Only the desugarer changes.
    But then a `defsyntax` handler can never *receive* a clause — which forecloses the only reason to
    build this.
*   **(c) A distinct `_type`** (a `clause-list`). Most expensive, and **the only one where forgetting a
    consumer cannot be silent**: C's `resolveAstExpr` already ends in `default: throw this.refuse(node,
    node._type)`, and the generated `lib/std/llang/ast.lisp` (89 kinds, freshness-gated by
    `test:docs`) turns red until it is regenerated. The forcing functions exist already.

**The handler-binding half is still open and is genuinely separate.** `defmacro` binds positionally
today, and `80-adversarial/for_as_macro.lisp` proves that is sufficient for `for`'s real
`:init/:cond/:step/:then` surface — the clause markers arrive as ordinary tokens and are simply named
and ignored. Whether `defsyntax` should do the same, take a map, or bind named parameters is untouched
by any measurement above.

**The refusal now explains itself**, which needed no ruling and was the one shippable part.
`(myform :then 1)` reported `Expecting token of type --> RParen <-- but found --> ':then' <--` —
accurate, useless, and identical to what a stray brace says. It now names the rule it is enforcing and
points at `defmacro` as the tier that *can* spell a user-defined keyword surface today, with the raw
parser text retained in brackets. No heads are enumerated: "`:then` belongs to `cond`/`for`/`if`/
`when`/`while`" is true today and would be a fifth place for the grammar to drift away from. Guarded
in `test:grammar-v2-smoke`, including the case that matters more — an ordinary parse error must still
arrive **verbatim**, or the special case has quietly become the general one and every unbalanced paren
blames a keyword.

### Two clause markers are lexed and parsed by NOBODY

`IsModKw` (`:is`) and `WhereModKw` (`:where`) appear only in `tokens.ts` — three references each, all
declaration — and in **no parser rule at all**. Writing either is a parse error.

Found while counting the clause surface above. The two corpus files that use them,
`04-pattern-matching/03_pattern_kinds.lisp` and `06-value-semantics/01_structs_refinement.lisp`, are
**both xfail already**, so nothing regressed and nothing measured this — the tokens are lexed for a
syntax that was never built.

This is the *frontend's* instance of the "who calls it?" failure mode: a token is not a feature.
Whether `:where`/`:is` should be wired (they read as refinement syntax) or removed is a language
question, unruled and untouched here.

### `l-lang run` on the JS backend leaks the COMPILER's argv into the program

Found while giving `std/sys/process` its first corpus file. Re-measured after **D104** made C the
default, which inverts which invocation is the broken one:

```
l-lang run prog.lisp                 args.length = 0          # C, the default
l-lang run --backend js prog.lisp    args.length = 4,
                                     args = ["run", "--backend", "js", "<abs path>/prog.lisp"]
```

Note the leak swallows the FLAGS too, not just the subcommand and the file — the old transcript here
read `["run", "prog.lisp"]` because it was taken from an invocation that passed no flags.

**Not a codegen bug, and not the floor's.** `sys-arg` on JS is `process.argv.slice(2)`, which is
right for a compiled program run as `node out.js` — and that is exactly how `test/runner.ts` invokes
it, which is why the corpus sees `0` on both backends and the new guard passes on both. The CLI's
`run` is different: it evaluates the emitted JS **inside the compiler's own process** (`evalInScope`),
so `process.argv` belongs to the compiler. C is unaffected because `run` execs a real binary.

So a program that reads `args` behaves differently under `l-lang run` than as a built artifact, on one
backend. Recorded rather than fixed: D66 freezes that backend, and the fix is in the CLI's execution
model rather than in anything the language rules. **D104 made the correct path the default one**, so
this is now reached only by opting into the oracle.

### `this.field` arithmetic loses 64-bit Int on JS — and it broke `std/math/random`

Found by asking **"what does nobody call?"** — the method that found `std/fn`'s `partial`. An audit of
all **534 stdlib exports** against every call site in `examples/` and `lib/` left **10 with no caller
anywhere**; `default-random` was one, and pulling that thread found this.

**D51 makes Int a 64-bit two's-complement value that wraps.** JS represents it as a BigInt, so every
arithmetic site needs wrapping back. It does that for a local and for a plain field store — both
measured — and **not** for `this.field` inside a method:

| | C | JS |
|---|---|---|
| one step | `-7046029254386353131` | `-7046029254386353000` |
| two steps | `4354685564936845354` | `-14092058508772706000` |

**Two defects in one value.** `…353000` is not a wrapped `…353131`, it is a *rounded* one — the operand
went through `Number`, whose mantissa is 53 bits, so the low digits are gone. The second is the missing
wrap: `-14092058508772706000` is past `INT64_MIN` and was never reduced mod 2^64.

**The consequence is a stdlib module that does not do what its header says.** `std/math/random` seeds
with SplitMix64 via exactly this shape, so **the same seed produces a different stream on each
backend** — against a module whose stated design is *"seeded determinism is the API… a program that
seeds it is a golden of itself."* **Nothing in `examples/` called `Random` at all**, which is why
neither was ever caught.

**C is verified against the algorithm, not against itself.** An independent Python implementation of
SplitMix64 + xoshiro256** reproduces C's four seeding words and its first three outputs exactly. That
is the only honest way to golden a PRNG: its output cannot be derived by inspection, so capturing what
the compiler printed would freeze whatever it happened to do.

Guarded by `80-adversarial/int_field_arithmetic.lisp` (the root cause, four lines, with the local as
the control that localises it to the receiver) and `random_seeded_stream.lisp` (the consequence, plus
the reproducibility property itself). Both C-only; **D66 freezes the JS path**, so this is recorded
rather than fixed there.

**What the other nine were, exactly.** Six are functions and were probed on both backends —
`skip-while`, `dump`, `dbg-at`, `try-open` and `default-random` itself all behave identically; `alert`
and `read-line` need a host or stdin and were **not** exercised, so no claim is made about them. Three
(`Dict`, `Str`, `Disposable`) are TYPES, where "no call site" only means no annotation mentions them —
a much weaker signal than an uncalled function, and not evidence of anything.

So the audit's yield was **one real defect out of ten candidates**, and it was in the place the method
predicted: an export nothing exercises. The method is cheap enough to re-run whenever the stdlib
grows — 534 exports, one script — and its value is that it looks where the corpus structurally cannot.

### ~~A container literal reaching codegen as raw AST emitted UNBOXED elements~~ — **CLOSED**

Found while measuring whether `std/fn` could be made portable, and it is the worst-shaped defect this
session turned up: **`cc` accepted it without a word.**

`resolveAstExpr`'s `vector` case declared its element type as `C_VALUE` and then handed the elements
over raw. The HIR path never had this — `InsertCoercions` boxes for it — but the **raw-AST re-drive**
gets none of that, and a method call on a literal receiver takes the raw path:

```
([1 2 3].reduce …)   ->   ll_vec_of(3, (ll_value[]){INT64_C(1), INT64_C(2), INT64_C(3)})
```

**`ll_value`'s first member is the tag.** A scalar brace-initializes it, so those three elements
decoded as tag 1, 2, 3 — `Int 0`, `Real 0.0`, `Bool false`. **Zero diagnostics at `-Wall -Wextra`**:
it is legal C that means something else entirely. It surfaced as `TypeError: expected a number` from
folding the Bool, which points at the reduction rather than at the literal.

The map twin was unboxed too. Every consumer reached so far happened to coerce on the way in — a
class-field default stores into a `value` slot — which is the kind of luck that stops being lucky.

Guarded by `80-adversarial/literal_element_boxing.lisp`, whose elements are **1, 2 and 3 on purpose**:
they *are* the tags `LL_INT`/`LL_REAL`/`LL_BOOL`, so the miscompile is maximally visible. A guard
written with round numbers would have passed — `[100 200]` is past the tag range and decodes as nil.

### ~~A method on an INDEXED receiver refused on C~~ — **CLOSED**

`(gs[0].hi)` — the dispatch-table shape, and one of the two things blocking `std/math/fft`.

`classifyList` mints a **call** for it because `isDottedMemberIndexer` says the suffix chain ends in a
dotted member, which is D1's rule that `(obj.m)` is a call while `(obj["m"])` is a read. The callee is
then an `indexer` rather than a name, and C had only `ELL0106 computed-callee` — **while
`resolveCall`'s `member` case ten lines above it already did exactly this job** for a computed receiver
arriving from the pipeline desugar. Two spellings of "call a method on something you had to compute
first"; one of them lowered. (The sibling-rule failure mode again.)

The chain is walked **one index short** rather than sliced, because `xs[0].a.b` may arrive as one
member group of two names or as two groups of one, and both spellings mean the same thing. A chain not
ending in a dotted member returns `undefined` and falls through to the refusal, so **D1 does not
move**: `(m["f"] 5)` is still a block yielding 5.

**The native half diverges, and the oracle is the wrong one.** `(rows[1].length)` answers `2` on C and
dies on JS with `TypeError: __ll_index(...).length is not a function` — the frozen backend emits the
member as a property and then calls it. A codegen bug (D66), not a disagreement about meaning. So the
user-class cases are graded on both backends (`indexed_method_call.lisp`) and the native ones on C only
(`indexed_native_member.lisp`, `oracleDivergent`) — the split is exactly the native-member case and no
wider.

### `std/math/fft` is blocked, and its draft is gone

**One of its two blockers is now gone** — the `computed-callee` refusal above is closed. What remains is
the unpinned JS index bug, and the rewrite itself. Its
sibling `random` shipped by redesign (D65, seeded xoshiro256\*\*, using D61's bit operators) rather
than by waiting for the blocker to lift, which is the available route here too. **The drafted module
is lost** — it was held in a scratchpad that no longer exists — so this is a rewrite, not a recovery.

### The stdlib remainder Dove's build order did not reach

Eight of the ten Tier-1 modules shipped as D76–D80, D65, D67 and `std/test`. Still unbuilt:

*   [ ] `std/collections`, `std/math/fft`, `std/os/fs`, and seven Tier-2 floor entries
*   [ ] the 12-operator LINQ shelf, and `std/seq`'s seven mirror holes
*   [x] ~~**`std/fn` is a JS module wearing a portable module's clothes**~~ — **DONE**. `partial` and
      the module-private `apply` were `func.apply null args`, a JavaScript method on a JavaScript
      function object, so `TypeError: no such method on this value` on the reference backend. They are
      `(func ...args)` now — D93's spread call, which is exactly what `func.apply` was imitating. The
      blocker had been gone since `dc4df1a`/`c1bccb9`/`ff95b4f`; the module was simply never
      rewritten. (`funcs.reduceRight` was never a host call — it is a real native method and
      `compose` always worked.)

      **It survived because nobody called it.** `16-stdlib/test_stdlib.lisp` exercises `identity`,
      `constantly` and `compose`; `partial` had **no call site anywhere** in `examples/` or `lib/`.
      This project's own question, inverted: not *"who calls it?"* but *"what does nobody call?"* —
      an export with no caller is the one place a defect can sit at rest. Guarded by
      `80-adversarial/std_fn_portable.lisp`.
*   [ ] the `--portable` advisory, and the Bytes / text-only-I/O ruling

### Older entries

*   **PARKED (2026-07-27): a nested `if` with `when` leaves ran BOTH branches.** Found building
    `std/cli` (D80). Written as a three-argument `if` nested in the THEN branch of another, with `when`
    in the leaves, `--lib=/opt/l` BOTH consumed the following token as its value AND reported
    "option '--lib' takes no value" — two mutually exclusive outcomes in one pass, while the flag
    printed `true` from inside that same branch. No diagnostic, on either backend.

    **It did not reduce.** Plain nested if/else, and a `when` as an if branch, are each correct in
    isolation on both backends, so the trigger is the combination and is not characterised. Parked
    deliberately: a round would open with an open-ended hunt rather than a fix, and the flat `cond`
    spelling has no user-visible breakage. **A second sighting is what would make it reducible** — this
    entry exists so the next one has somewhere to attach. `80-adversarial/cond_dangling_else.lisp` and
    `paren_absorption.lisp` are the neighbours; this family has bitten before.

*   ~~**The corpus cannot say "pinned against C, oracle known-wrong".**~~ — **CLOSED (D86).**
    `manifest.ts` gained `oracleDivergent` on a `test` entry: graded on C against its `.expect`, and
    reported on the JS run as its own `🔀 DIVERGENT` status carrying the measured reason. It mirrors
    `negative`, which is graded on JS and skipped on C. Counted in the summary deliberately — a growing
    number means the frozen oracle is drifting further from the reference, and that should be visible
    without `--verbose`. The three files that were parked for want of it are now pinned:
    `20-algorithms/00_bfs`, `80-adversarial/hyphen_field_encoding`, and
    `80-adversarial/mangle_hex_terminator`. C 257 → 260.

*   **JS DROPS CONSTRUCTOR ARGUMENTS (oracle-only, D66).** For a class or struct with no explicit
    `:ctor`, `(new Point 3 4)` answers `(0, 0)` on JS and `(3, 4)` on C. Reduced to five lines; it is
    what makes `00_bfs` fail on the oracle. Not fixed — the JS backend is retained for differential
    testing only — but it belongs on the known-divergence list Round D's fuzzer consumes, beside
    chained-call Int precision (D78) and the skipped `:ctor` initializer (D80). This is the broader
    defect of the two: the arguments never reach the constructor at all.

*   **`KeyError` does not name the key on C.** JS raises `KeyError: 0,1`, C raises
    `KeyError: missing key`. Cosmetic, and small, but it is the one D82 trap message that does NOT
    match its JS twin — `ll_trap_index` was matched verbatim (`IndexOutOfRange: 99 (length 3)`)
    precisely so a catchable trap reads the same on both. Found while fixing `00_bfs`.

*   ~~**Spread adjacency should be ruled like `..` was (D88/N4).**~~ — **CLOSED (D93).** `...` now
    binds by adjacency, checked the same way `..` is: the `Spread` token's end offset against the
    operand's start. A spaced `... xs` is not a spread and is **LL0037**. It cost the corpus nothing —
    measured 80 tight spreads and zero spaced ones, where `..` had needed a 16-file migration.

*   **Comparisons and `%` across dimensions are NOT ruled (D90).** `(< metres seconds)` and
    `(% metres seconds)` are the same category error `+`/`-` now refuse, and both are still silent.
    D88 ruled `+`/`-` and nothing else, so D90 built exactly that. The cost of extending it is
    measurable and was measured: a comparison rule would refuse `(< brightness 255)`, which the corpus
    already contains, so it needs a `:unit`-aware answer of its own rather than a one-line widening.

*   **`:of` is nominal where the checker is structural (D89).** A class that conforms to an interface
    by shape is accepted by `[x <- Ring]` at compile time and answers `false` to `(x :of Ring)` at run
    time. Two answers to one question. Reconciling them is a runtime-metadata change, not a checker
    one, and `80-adversarial/ring_protocol.lisp` pins both halves so the day it moves is visible.

*   **Operator dispatch does not reach a boxed value (D89).** `(* x x)` where `x` is a `<- Ring` or
    `<- Any` parameter unboxes as a number and traps `expected a number` — measured identical for
    both, so this is not about protocols. It is why a protocol constrains parameters usefully and
    cannot yet compute through them.

*   **`..` is a LIST form, not an expression-level operator.** `[1..2 3..4]` does not parse (the
    vector/matrix rules consume plain expressions and the `..` branch lives in the list rule), and
    `(let a 1..2)` is not a range — the branch fires only when the `..` and its two operands are the
    WHOLE list, so a range needs its own parens. Both predate D88's adjacency ruling. `Range.start` /
    `Range.end` also have no C lowering (`ELL0106 method:Range.start`).

*   **PARKED (2026-07-27): decoration-time SETUP hoisting on C.** A decorator whose `defmodifier` body
    has statements before the wrapper — `(let cache {})` in `:memoized` — is refused BY NAME
    (`decorator-setup:<modifier> on '<fn>'`, `collectDecorated`) rather than dropped, because dropping
    the setup silently would give every call a fresh cache. It is the last non-async C refusal
    (`10-modifiers/05_multiple_modifiers`), and it also blocks `20-algorithms/10_memoization_modifier`,
    whose fix is to declare the `:memoized` the file already applies.

    **Naming is not the blocker, which is the part worth writing down.** The unfolded layers are
    already per-site unique — `emitLayer` builds `sum__w0`, `sum__w1`, … `sum` — so a hoisted `cache`
    can be `sum__w1__cache` and collide with nothing, no new scheme required. Encoding the decorator's
    ARGUMENTS in the name (`retry_4`) would be actively wrong: two sites carrying the same decorator
    with the same arguments would then share one cache, and per-site is the correct key.

    **What is missing is the REDIRECT.** `emitLayer` lowers the wrapper inside `isolated()`, so `cache`
    in the wrapper body resolves as a local of that layer. Setup has to lower ONCE at module scope and
    then be pre-declared into the layer's scope bound to the global cName. A `{}` initializer is a
    runtime call, not a constant, so it needs the module-scope ASSIGNMENT slot
    (`globalNames`/`globalDecls`/`globalDeclared`) rather than a file-scope initializer.

*   **PARKED (2026-07-27): `for :init` mutable capture on C.** `03-loops/01_for.lisp` is the corpus's
    one `not-yet`: it compiles and loops forever. `j` is a `mut` that a nested `inc-j` mutates, so
    D48/Q3 makes it a by-reference capture, but `computeCellVars` does not promote it inside a
    `for :init` block — the env gets a copy, the counter never advances. The reduced cause with the
    emitted C is written out at `src/test/c-status.ts:28-40`; this entry is the pointer, not a second
    copy of it.

*   ~~**`export` has no CIR lowering, and it is SIX of the eleven C refusals.**~~ — **FIXED.** One
    `case "export": return []` beside the existing `import` arm. C went 239 -> 245 passing, refusals
    11 -> 5, and the six files now grade against goldens they had never reached. Original entry: `(export …)` at a module's
    top level is `ELL0106 Cannot generate C for 'export'`, so any module carrying one cannot be compiled
    standalone — `15-modules/00_lib`, `01_lib_a/b/c`, `18-error-handling/20_imported_error_lib` and
    `21_imported_error_tower_lib` all refuse for this one reason, each with a golden it never reaches.
    Codegen-wise an export is a no-op (it is a symbol-table fact, already consumed by the imports pass),
    so this is plausibly a very small fix with a disproportionate effect on the refusal count.

*   **`__ll_member` is a thermometer.** Where the checker cannot type a receiver, `(obj.m)` is dispatched
    at run time rather than guessed (D1, amended by Xe). It is correct, and it is also a **measurement**:
    every site that reaches it is a receiver the type checker failed to infer. It read **50** sites; three
    MECHANICAL gaps (the type was known, the lookup or storage was wrong) closed it to **23**:
    - a self-referential return type stored as Unknown (`(fn :operator + [o <- V] -> V ...)`, `1b9bec5`),
    - a member looked up by its ENCODED rather than SOURCE name (`get-area` → `get2darea`, `801b660`),
    - an INHERITED member not followed through `:extends` (`this.name` in a subclass, `5f705de`).

    **Phase T then closed the String/Array half.** A native-member side table (`nativeMembers.ts`),
    consulted by BOTH the checker and codegen, types `s.toUpperCase` / `s.length` / `arr.shift` /
    `arr.reverse` and emits a direct `.member()` instead of `__ll_member` — so `lib/std/string` (its
    receivers annotated `<- String`) now emits ZERO. What line 319 called "genuine JS interop the
    compiler *correctly* cannot type" was, for String and Array, prelude work after all — just via a
    hardcoded side table (checker + codegen), not `js.lisp` declarations.

    What remains, and neither is a mechanical lookup bug:
    - **`Date` / `Error` interop** — `Date.now`, `err.message`. `:extern` values with no clean type
      representation; a smaller residual than the "~14" that included the now-typed String/Array members.
    - **~9 harder inference**, each its own phase: **collection element types over array-of-MAPS**
      (`(for :each user :from users)` — `visitForEach` binds the loop var to `T` (Itb), but `users` is an
      array of MAP literals, so `user.name` needs **record types**), and **field-access chains**
      (`game-state.player.pos.y`, where `player` was declared `nil`). (`arr.shift`'s element return is
      now typed by Phase T.)

    Watching that number fall is the cheapest available measure of the "does not infer every expression"
    gap.

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

*   ~~**Expression vs statement.**~~ — **FIXED (Phase X + Xg).** `isExpressionContext()` — a **positional**
    property answered by an **ambient-state** query — is gone from the active (Estree) backend, replaced by
    the positional `visitExpr`/`asExpression` scheme: each form emits one canonical shape and the consumer,
    which owns the slot, coerces. So `(console.log (when false 1))` emits `console.log(false ? 1 : null)`.
    The last shape, `((D).hi)` — a member on a COMPUTED object — is fixed by **Xg** (a desugar rewrite to
    the `MemberNode`/`CallNode` core nodes). The same disease Phase F cured in the call decision, and
    `isExpressionContext` is now gone from the tree entirely — the `legacy-js` backend that still
    carried it was retired in `f1f2c5c`. (A trailing `if` keeping its value is **D18**.)
*   **The type checker does not infer every expression** (improving). 114 `list` nodes once had no
    entry in the type channel; the three mechanical gaps are fixed (thermometer 50 → 23), and Phase T
    then typed the String/Array native members. What remains uninferred is a harder class — collection
    element types over array-of-maps (record types), `Date`/`Error` interop, and field-access chains
    (see the thermometer entry). Caps what codegen can prove — the reason the struct-copy elision came
    in at 138 rather than the 353 predicted.
*   ~~**The call-vs-block rule is implemented three times.**~~ — **FIXED (D25).** All three live passes —
    codegen's `visitList`, the checker, and the desugarer — now read the single source, `listForm.ts`
    (`classifyList`/`isCallList`/`valueIsTail`), instead of each guessing from `head._type ===
    "simple-identifier"`. The `legacy-js` backend that kept an independent copy was retired in `f1f2c5c`.
*   ~~**`03_matching.lisp`'s golden asserts a bug**~~ — **FIXED (D26).** `(< _ 0)` was never a guard;
    it parsed as a 3-element list-pattern `[<, _, 0]` and every arm fell through, and the golden recorded
    the fall-through as the answer. Guards are now a real clause (`n :when (< n 0)`), and the golden is
    re-authored from intent: `just a baby` (Math.random is [0,1), so `(< n 10)` wins deterministically).
    The one golden this session that was *supposed* to move.
*   **Pattern matching: only `functional-pattern` is still dead.** Guards (D26), `:of` type patterns
    (D27) and `[a ...rest]` rest patterns (D28) all work now and compose. The last kind hitting
    `generateCondition`'s `default: false` is `functional-pattern` — matching a value by its function
    *signature* — which may not be meaningfully implementable on a JS target (a closure carries no
    parameter types at run time). Rest is trailing-only and named-only; a mid-list rest and anonymous
    `[a ...]` are unbuilt.
*   ~~**`((fn [x] …) 21)` does not compile.**~~ — **FIXED (D25/Xc).** Its head is a **lambda**;
    `classifyList` now reads a lambda-literal head with arguments as an `apply` (`lambdaLiteralIn`), and
    codegen emits the call. `((fn [x] (* x 2)) 21)` → `42`.
*   ~~**`(call f a b)` is the tenth "written and never wired in"**~~ — **FIXED (Xc), and the original
    claim was wrong.** `call` was not missing; it was a runtime shim `(f, args) => Array.isArray(args)
    ? f(...args) : f()`, whose second parameter is an argument ARRAY — so `(call g 2)` **silently drops
    the argument** and returns `NaN`. `(call f a b)` is now desugared to the `CallNode` that codegen
    could always emit and no source syntax ever built.
*   **Missing diagnostics.** ~~Assigning to a `let` is not checked~~ — **CLOSED**, LL0233
    `ImmutableAssignment`, wired through `checkImmutableAssignment`. `(new)` with no class
    name emits a bottom value. `LL0212` is a syntactic hack that can now be done properly. (`LL0211`
    *does* know required-vs-total arity now — a defaulted `:ctor` member is optional, and an inherited
    one counts. `fn` parameter defaults still do not exist.)
*   ~~**`visitExport` throws instead of diagnosing.**~~ — **CLOSED.** It reports **LL0232**
    (`CannotExportUndefined`) and continues; the re-export stance is now stated in the diagnostic's own
    text rather than left unsaid.
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

    **Amended by Qg (AF-004).** "FIXED" was true of the shape above — a correct decoder being
    bypassed — and false of the decoder's own coverage: it had a `￿` alternative and **no `\xNN`
    one**, so `\x1b` matched the catch-all, took the "an unknown escape is the character itself"
    branch, and decoded to the three characters `x1b`. Silent: a length-10 ANSI string arrived as 14
    and simply failed to colour anything. The audit read this entry as a stale claim, and it was.
    Qg also found a live NUL bug next door: the decoder keyed on `esc[0]`, but the catch-all yields a
    ONE-character esc, so a malformed `"\uZZZZ"` took the unicode branch and computed
    `fromCharCode(parseInt("", 16))` = `fromCharCode(NaN)` = **NUL**. Both now key on LENGTH (`u`+4,
    `x`+2). Fixing `\x` on the old `esc[0]` test would have duplicated that bug rather than exposed
    it — the malformed-escape guard is what caught it.
*   **Parse/lex gaps.** Boolean match patterns; `:is` type patterns; sized array types; `fn` parameter
    defaults. ~~the `..` range operator~~ — shipped in D88 (the `Range` token, adjacency-bound; the
    remaining half is the separate "`..` is a LIST form" entry below). ~~the numeric tower
    (octal/binary/hex/fraction/complex all lex, none emit)~~ — **emits on C** (D88/N1–N3), pinned by
    `80-adversarial/numeric_radix_literals.lisp` and `numeric_promotion.lisp`; it is the **JS oracle**
    that cannot emit radix literals (`ELL0100 visitHexNumber`) or promote, which is why both are
    `oracleDivergent`. (`__bar` **now lexes** — fixed via `longer_alt`, inbox #1.)
*   **A module boundary is not transitive.** If A imports B and B imports C, A can still name C's
    exports — `SymbolTable.join` splices every module's scopes in, and the import check declines to
    invent a diagnostic where no *direct* import was recorded. Whether a boundary *should* be
    transitive is a real question, and **D20 does not answer it**.
*   ~~**`:as` aliasing is unimplemented.**~~ — **CLOSED.** It binds on BOTH sides of the boundary on
    BOTH backends, pinned by `examples/80-adversarial/import_export_aliases/main.lisp` (import alias,
    export alias, and a class aliased through both), which is listed in `src/test/c-status.ts`. The
    surviving half of the entry is D46's scope: `:as` stays alias-only, and value conversion is the
    separate `(cast<T> x)` form.
*   **Identifier encoding escapes into DATA.** D13 ruled map keys are never mangled, but *class members*
    still are: `player-pos` is emitted as `player2dpos` (`-` → its hex `2d`). This is invisible while the
    program only talks to itself, and wrong the moment the data leaves — `JSON.stringify` of an instance
    dumps `player2dpos`, and any external JSON consumer sees a key the source never wrote. Same mechanism
    already sighted twice above: the `get-area` → `get2darea` member-lookup bug, and `count-neighbors` →
    `count2dneighbors` in a live stack trace. Operators ride the same encoding (`&&` → `_2626`). The
    encoding is not the bug — its escape into the serialization boundary is. Not critical; not filed as an
    audit AF; wants a ruling on where the boundary sits.
*   **Harness.** The "0 corpus diagnostics" count covers only `status: "test"` files — `library` and
    `xfail` are excluded — though that hole is much smaller now: the stdlib **runs** (`test_stdlib` has a
    golden), and `lib/` is walked alongside `examples/`. (The frontend half of this gap is **gone**: it
    used to read "pinned to grammar_v2, so this is a single-frontend claim". Since D39 there is only one
    frontend, so the pin is the whole truth.)

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
        `get`/`head`/`elem` are the language's only `T?` producers and their type WAS inexpressible until
        call-site generic inference — which **now exists** (Phase 5, P5b-d), so `first`/`last`/`at` are
        declared `<T> … -> T?` (Phase T / Ga) and `std/core` is unblocked. (The builtins still self-
        disable the moment a name resolves, which is why they stay in `SYMBOL_MAP`.)
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

## 🚧 Phase It: Protocols back the syntax (D29) — iteration first (D30)

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
*   [ ] **The core tail (D48).** The readiness report's remaining dips resolved *onto* nodes. Step 1,
        the cheap drains, is **done** — the A5 copy-decision (as `copies` fields on `HReturn`/`HVarDecl`
        rather than a distinct `HCopyStore`), the field-get slot on `HMemberRead`, and callee-identity
        on the call nodes. **The core tail is DONE.** `HMatchTest` landed (A7 drained
        144 -> 2, its floor); the **closure representation** landed (HClosure carries the capture set and
        each capture's D10-derived mode); `HFor` gained a statement-bearing `:step`, draining the
        `raw-structural` family to zero; and **A1 field types** now ride `HFieldDecl`/`HCtorParam`, so a
        native backend no longer walks the class body to learn what a field IS. Governed by A-0: nodify what *both* backends decide;
        reclassify only genuine single-backend passes (A6 coercions leave core).

## 🔮 The language-feature lane (2026-07 design round)

The Sabaka⇄Dove design round (`docs/inbox/hir-design-round-brief.md`) ratified a lane of language
features on the now-solid HIR / coercion substrate. **Post-design-round sequencing:** the HIR core tail
(Phase 6, D48) → the conversion substrate (Cv) → bounded generics + ergonomics (Bg) → conditions /
restarts (Cr). All of it is JS-safe (degrades, no-ops, or refuses honestly), so none *depends* on native
surviving — it pays *extra* if native does.

### 🔮 Phase Cv — the conversion substrate (D46)
The coercion pass reframed as the type system's checked-conversion layer. In order:
*   [ ] **B-0 tokens:** `deftype`'s required `<-` binder, the `..` `Range` token, the `:where` modkw.
*   [ ] **Native fixed-width ints (B-2):** `uint8`/`int32`/… → `uint8_t` etc. — a fixed-range refinement
        materialised as a native width. No-op-to-`Int` on JS.
*   [ ] **Refinements (B-1):** `T :where (pred)` — a predicate over the value (total); `(lo .. hi)` range
        sugar desugaring to a predicate; regex via a stdlib `matches?` predicate, never grammar (B-1a);
        record-field refinements on the field (B-1b).
*   [ ] **`defcast` (B-3):** `:implicit` (one-hop, lossless-widening, at coercion sites) / `:explicit`
        (`(cast<T> x)`), keyed by type-pair on the operator devirt path.

### 🔮 Phase Bg — bounded generics & ergonomics
*   [ ] **The three `:where` relations** (`:is` / `:extends` / `:implements`, type-variable subject only)
        — reuse the existing `typesEqual` / `isSubtype` / `conformsStructurally` predicates.
*   [ ] **Small greenlit ergonomics:** `|> .method` selectors (desugar over the pipe), flags enums
        (`:with Flags`), `with`-copy (`(with s :field v)`), `:readonly` fields, attributes → reflection
        (`:with Attr`, wired into `type`), `:stack` allocation (needs escape analysis).

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

Ratified in the 2026-07-23 round over `docs/inbox/coroutines-and-memory-brief.md`. The C backend has
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

## 🚀 Phase 7: The Speed of Light (v1.0.0)
**Theme:** "The Sloth becomes a Cheetah."

*   [ ] LLVM IR codegen visitor
*   [ ] Strict memory layout
*   [ ] Native standard library

---

## Known gaps

Live, reproduced, and deliberately not yet fixed. Full evidence in `docs/spec/DECISIONS.md`.

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
    the `MemberNode`/`CallNode` core nodes). The same disease Phase F cured in the call decision; only the
    deprecated `legacy-js` backend still carries `isExpressionContext`. (A trailing `if` keeping its value
    is **D18**.)
*   **The type checker does not infer every expression** (improving). 114 `list` nodes once had no
    entry in the type channel; the three mechanical gaps are fixed (thermometer 50 → 23), and Phase T
    then typed the String/Array native members. What remains uninferred is a harder class — collection
    element types over array-of-maps (record types), `Date`/`Error` interop, and field-access chains
    (see the thermometer entry). Caps what codegen can prove — the reason the struct-copy elision came
    in at 138 rather than the 353 predicted.
*   ~~**The call-vs-block rule is implemented three times.**~~ — **FIXED (D25).** All three live passes —
    codegen's `visitList`, the checker, and the desugarer — now read the single source, `listForm.ts`
    (`classifyList`/`isCallList`/`valueIsTail`), instead of each guessing from `head._type ===
    "simple-identifier"`. Only the deprecated `legacy-js` backend keeps an independent copy.
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
*   **Parse/lex gaps.** Boolean match patterns; `:is` type patterns; the `..` range operator (now
    specced as the `Range` token in D46 / Phase Cv); sized array types; `fn` parameter defaults; the
    numeric tower (octal/binary/hex/fraction/complex all lex, none emit). (`__bar` **now lexes** — fixed
    via `longer_alt`, inbox #1.)
*   **A module boundary is not transitive.** If A imports B and B imports C, A can still name C's
    exports — `SymbolTable.join` splices every module's scopes in, and the import check declines to
    invent a diagnostic where no *direct* import was recorded. Whether a boundary *should* be
    transitive is a real question, and **D20 does not answer it**.
*   **`:as` aliasing is unimplemented.** It parses in both frontends, on both the import and the
    export side, and nothing honours it. (D46 keeps `:as` import/export-alias-only; value conversion is
    the separate `(cast<T> x)` form, not `:as`.)
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

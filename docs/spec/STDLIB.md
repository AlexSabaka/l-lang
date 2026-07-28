# The l-lang standard library — the standard

> **Status: Sa–Sd are done; Se–Sg are not.** This document was written when none of it existed, and
> §1 and §2 below are the measurement that justified the rulings — they describe the tree **as it was**
> and are kept as evidence, not as a description of the present. What has since changed:
>
> - the stdlib is real, at `lib/std/` — 11 modules, resolved by name through `ModuleResolver` (Sc);
> - **the module boundary is enforced.** §2's "the module boundary is fake" is closed: LL0215 (not
>   exported), LL0216 (not bound), LL0217 (unresolvable), LL0232 (export of an undefined name),
>   LL0235 (an import list naming something the module does not offer), and `:as` binds on both sides;
> - `JS_GLOBALS` is dead and `:extern` is real, behind `lib/std/js.lisp` (Sd);
> - much of what §1 calls "the runtime shim" is now **the intrinsic floor** — see
>   [`FLOOR.md`](./FLOOR.md), Phase F, which is complete. That phase also collapsed `std/seq`,
>   `std/string` and `std/io` from native implementations to l-lang written on the floor.
>
> - **Se is done (2026-07-22), but not as written** — see §4. `SYMBOL_MAP` does not leave the code
>   generator, because it *is* the floor's JS backend; what it gained is a conformance check against
>   the floor, and its four unmodelled orphans are now modelled.
>
> Still open, and the reason this document is not archived: **Sf** (the cstd-shaped modules, typed and
> actually *executed* rather than `status: "library"`) and **Sg** (retirement). §5 is the note that
> matters most for those.
>
> Rulings live in [`DECISIONS.md`](./DECISIONS.md) as **D19–D22**. This is their evidence and their
> expansion.

---

## 1. The stdlib already exists three times, and the three do not agree

Everything in this section was measured against the corpus, not inferred.

| # | Mechanism | Where | Size |
|---|---|---|---|
| 1 | **The runtime shim** | `RuntimeProvider.SYMBOL_MAP` | 12 functions |
| 2 | **The type checker's allowlist** | `InferTypesAstVisitor.JS_GLOBALS` | 30 names |
| 3 | **Actual l-lang source** | `examples/20-stdlib/std/*.lisp` | 6 modules, ~290 lines |

### Head 1 — the runtime shim

`get head tail empty elem cons list call eval type set! set?`, injected into every program **as
text**. Not importable, not typed, not shadowable except by accident. `eval` is literally the empty
string — `(eval x)` falls through to host JS.

`SYMBOL_MAP`'s own comment already draws the line, and it is the right one: an **operator** is
language (it cannot be shadowed, imported, or redefined — only overloaded), a **function** is an
ordinary importable name. This half is the second kind, and it is the D7 worklist.

### Head 2 — the type checker's allowlist

A hardcoded set of 30 JS global names that the checker waves through **untyped**:

```
console Math JSON Object Array String Number Boolean Symbol Error TypeError RangeError
Date RegExp Map Set WeakMap WeakSet Promise Proxy Reflect BigInt parseInt parseFloat
isNaN isFinite NaN Infinity globalThis window document navigator process
setTimeout setInterval clearTimeout clearInterval fetch
```

**This is not a standard library. It is a hole in the type system.** Everything reached through it
is `Unknown`, and under gradual typing an `Unknown` silences every check downstream of it. Measured
usage across the corpus:

| Global | Uses | Note |
|---|---|---|
| `console.log` | **579** | The single most-used name in the language. Untyped. |
| `Math.*` | 14 distinct fns | `sqrt random log tan sin round pow min max floor exp cos ceil atan` |
| `Object.is`, `Array.isArray`, `Number.isInteger` | 3 | the type predicates `std/types` is built on |
| `JSON.stringify` | 1 | |
| `Date.now` | 2 | |
| `window.*` | 3 | p5js only |

Closing this hole **is** "hide the JS". It is also, not coincidentally, the fix for the standing
Known Gap "no ambient-global declaration" — the 104 diagnostics hiding in the p5js bindings.

### Head 3 — the l-lang source that nobody runs

`examples/20-stdlib/std/` — `io enumerable functional math strings types`. Real l-lang, and some of
it good. Every file is `status: "library"` in the test manifest, which means **compiled, never
executed**. Its driver, `test_stdlib.lisp`, is `xfail`.

Because nothing ever ran it, nothing ever found out that:

- It calls **`length`, `first`, `last`, `at`** — four functions that exist in **no** std module and
  **no** SYMBOL_MAP. The test was written against a stdlib nobody built.
- **`Number` is `deftype`d twice** — in `types.lisp`, and again in `math.lisp`, *which imports
  `types.lisp`*. Both export it. Silent.
- `math.lisp` exports `Vector3` but **not** `Complex`. Both are defined; `complex_math_test` uses
  `Complex` anyway (see §2).
  - **Resolved (2026-07-23, D57).** `math.lisp` no longer defines *either*. `std/math` is now a
    modular package — `constants`, `elementary`, `complex` (`Complex`, re/im, the full field),
    `rational`, `vector` (`Vec2`/`Vec3`/`Vec`), `stats`, `special`, `integrate`, and a `symbolic`
    subpackage — and `math.lisp` keeps only the everyday scalar umbrella (the `Math.*` wrappers +
    `E`/`PI`/`TAU`). The old `Vector3` carried `(fn :operator ·)`, the U+00B7 head operator D57 bans;
    it and the placeholder `Complex` are retired, and their three consumers migrated to `Vec3` /
    `std/math/complex`. Everything is still reachable through one `(import "std/math")` (siblings).
    **`random` has since shipped** — `lib/std/math/random.lisp`, seeded xoshiro256\*\* / SplitMix64
    (D65), pinned by `examples/16-stdlib/11_random.lisp`. **`fft` is still blocked**; the reason and
    its status live in [`docs/roadmap.md`](../roadmap.md)'s Known gaps.
- `functional.lisp` exports **`apply`** — colliding with the `.apply` method call of **D17**. This
  is the exact collision `05_matching.lisp` had to hand-roll a workaround for.

---

## 2. The module boundary is fake

**`(export …)` is decorative.** A minimal repro: a module defining `public-fn` and `secret-fn` that
exports **only** `public-fn`; an importer that calls **both**. It compiles clean and prints both.
Zero diagnostics.

Why, precisely:

- `BuildSymbolTableAstVisitor.visitExport` records the list onto `SymbolEntry.exportName`.
  **`exportName` has zero readers.** Five hits in all of `src/`: one declaration, three `undefined`
  initializers, and that single write.
- `SymbolTable.join` splices **all** of an imported module's root scopes in, unfiltered.
- `JSTransformerAstVisitor.isImportedSymbol` — the gate that decides what gets inlined — tests only
  *"declared in another file"* and *"declared at module top level"*. **The code conflates top-level
  with exported**; its own comment calls a root-scope symbol "its export".
- **`InlineImportsAstVisitor` is the one pass that *does* honour the export list** — it builds an
  `exportedSymbols` set and filters against it. It is **commented out** in `Context.ts`.

> This is the **fourth** instance of *"the code was written and never wired in"* found in this
> compiler, after the desugarer, the runtime matchers, and the type channel. The pattern is now the
> single most reliable predictor of where a bug lives here. When a feature is claimed, the question
> to ask is not "is it implemented?" but **"who calls it?"**

**Also parsed and dropped:** `ImportDefinition.symbols`. A selective import — `(import { a } from
"x.lisp")` — is built by the AST builder and never read. It behaves **identically** to a
whole-module import.

### The blast radius, measured

Mirroring `isImportedSymbol` exactly and then asking the question it never asks (*is `exportName`
actually set?*), across the whole corpus:

```
files with cross-module references : 10
LEGITIMATE (exportName set)        : 46
LEAKED    (exportName UNSET)       :  9   <-- compiles today; must become a diagnostic under D20
```

All **9** leaks are in **2** files, and every one of them is the stdlib leaking into itself:

| File | Leaked name | From |
|---|---|---|
| `20-stdlib/test_stdlib.lisp` (now `examples/16-stdlib/test_stdlib.lisp`) | `abs min max pow ceil floor round inc` | `std/math.lisp` |
| `20-stdlib/complex_math_test/main.lisp` (now `examples/16-stdlib/complex_math_test/main.lisp`) | `Complex` | `std/math.lisp` |

**So enforcing the boundary costs one export list.** The 46 legitimate cross-module references are
untouched. This is the number Sb is planned against.

### There is no resolver, and no error path

Import resolution is a single line — `path.resolve(dirname(importer), literal)` — with no
indirection of any kind. No search path, no module root, no extension inference. **A missing import
is a raw Node `ENOENT` exception, not a diagnostic.** `std/` resolves at all only because the
importing file happens to sit one directory above it. Namespace imports (`import foo.bar`) parse,
then dead-end on *"not supported yet"*.

---

## 3. The standard

### D19 — the stdlib is a library, not a compiler feature

It lives in **`lib/std/`** at the repo root, ships with the compiler, and resolves **by name**:

```lisp
(import "std/math")     ; resolved against the stdlib search path
(import "./helper")     ; relative imports keep working, unchanged
```

Heads 1 and 2 are **holes to be closed, not APIs to be kept**. Their contents migrate into `lib/`.

### D20 — `export` is the module boundary

An unexported top-level symbol is **module-private**. Naming it from another module is a diagnostic.
A selective import binds **only** what it names. An unresolvable import is a diagnostic, not an
`ENOENT`.

### D21 — naming

Kebab-case. `is-x` for predicates — this is what the corpus already does, **10 of 10**
(`is-nil is-array is-int is-string is-bool is-even is-odd is-truthy`, `starts-with`, `ends-with`,
`sort-by`). Scheme spellings (`nil?`, `set!`) are **rejected**, including the ones the runtime shim
currently uses.

A module that is a **direct cstd binding** may *additionally* expose the C name, as an alias:

```lisp
(string-length s)   ; the l-lang name -- canonical
(strlen s)          ; the cstd alias  -- same function, for the native binding
```

This is by design, not by accident. It is what makes the Phase 7 binding mechanical rather than a
translation exercise.

### D22 — the layout mirrors cstd headers; the signatures stay l-lang

Each module declares the header it will bind to. Signatures use l-lang types (`T?`, `Int`, `String`)
— **no `char*`, no errno-returns, no out-params.** Phase 7 then binds **header-by-header** rather
than function-by-function.

| Module | Binds to | Surface |
|---|---|---|
| `std/core` | *(the language)* | `head tail cons list get elem empty` — from `SYMBOL_MAP` |
| `std/io` | `stdio.h` | `print println read-line open close` |
| `std/math` | `math.h` | `sqrt sin cos tan pow floor ceil round abs min max E PI` |
| `std/core/string` | `string.h` | `strlen substr split join trim starts-with ends-with` + `format-args` |
| `std/core/types` | *(the language)* | the portable type predicates, on `std/llang/reflect` |
| `std/core/async` | *(none)* | `Awaitable<T>`, `Task<T>` — D32 |
| `std/core/errors` | *(the language)* | the error hierarchy — l-lang's own `Error`, not the host's |
| `std/char` | `ctype.h` | `is-alpha is-digit is-space upcase downcase` |
| `std/time` | `time.h` | `now clock sleep` |
| `std/os` | `unistd.h` | `args env exit` |
| `std/seq` | *(none)* | `map filter reduce zip range` — pure l-lang, built on the above |
| `std/fn` | *(none)* | `identity compose partial constantly` |
| `std/llang/reflect` | *(the floor)* | `name-of kind-of parent ancestors find-method has-property …` — the typed surface over D54's metadata graph |

**This ratifies a drift rather than imposing a shape.** The existing corpus has already wandered
toward cstd on its own, without anyone deciding to:

- `math.lisp` is already ≈ `math.h` — `sqrt sin cos tan log exp pow abs floor ceil round min max`
- `strings.lisp` already uses **literal C names**: `strlen`, `substr`
- `io.lisp`'s `print`, with its `{0}` placeholders, **is a `printf`**

The two modules with no C counterpart (`seq`, `fn`) are the honest exceptions, and are marked as
such: they are the higher-order layer, written in l-lang, on top of everything else.

### 3.1 House rule — a library never divides two `Int`s and keeps the result

**Every division site in `lib/std` forces the operands Real or truncates the result.** Measured
2026-07-23 across 120 sites: each is either `(/ (sum-n xs n) (* 1.0 n))`, `(/ … 2.0)`, `(/ p 100.0)`,
or wrapped — `(Math.trunc (/ coll.length 2))`, `(truncate …)`. Nowhere does the stdlib divide two
`Int`s and keep an `Int`.

That is not style. **An imported body loses its static types**, so `(/ Int Int)` inside a library
becomes Real division at the call site — `3.5` on JS against `3` on C, from a function declared
`-> Int`, with no diagnostic from either backend. The stdlib is correct today only because every
author so far happened to write around it.

So it is written down here, because a convention that is nowhere stated is a trap for the next module
rather than a discipline. The games repo hit the same wall independently and formalized it as
`common/num.lisp`'s `int-div`.

*(Extracted from `stdlib-games-recon.md` §2.6 before that file was archived — it was the only place
this was recorded.)*

---

## 4. The worklist

In dependency order. Each is a sub-phase of Phase S.

- ✅ **Sa — the standard.** *(this document; docs + RED gates; the compiler is not touched)*
- ✅ **Sb — `export` means something.** **LL0215**. `exportName` has a reader. Cost, as predicted:
  **one export list** (`std/math.lisp`). A private symbol stays *resolvable* and is refused **by
  name** — telling someone a function they are looking at "is not defined" is a worse answer than the
  truth. **An operator is exempt** (W: it is language, not library; it has no name to export).
  Codegen was deliberately *not* given the check: its `isImportedSymbol` asks a **reachability**
  question, and a module's own private helpers must still inline transitively.
- ✅ **Sc — the import side.** `ModuleResolver`: `(import "std/math")` resolves **by name**, importer's
  directory first (anti-shadowing). An unresolvable import — and a **namespace** import, which used to
  log an error and *succeed anyway* — is now **LL0217**. A **selective** import binds only what it
  names (**LL0216**). The stdlib moved to **`lib/std/`**, so the resolver is load-bearing rather than
  ornamental, and `test:type-errors` walks `lib/` so it did not leave the harness on the way out.
  `LL0004 ImportHasSymbols` **deleted** — dead, and it encoded a false invariant.
- ✅ **Sd — ambient globals are declarable, and `JS_GLOBALS` is dead.** `:extern` is real (it had been
  unusable: LL0013 rejected every correct one for having the body it did not have). The 37-name
  allowlist inside the type checker is now **`lib/std/js.lisp`**, an implicitly-imported prelude —
  interop behind a library boundary, and **extensible**. p5js: **104 diagnostics → 0**, and the noise
  turned out to be hiding two guaranteed runtime crashes. A **three-name residual**
  (`String`/`Boolean`/`Number`) remains, named as what it is: l-lang resolves types and values from
  one namespace, and declaring `Number` as a value silently breaks `<- Number` **across a module
  boundary**. Declarations are **untyped** — typing them is a separate measured pass.
- ✅ **Se — the runtime surface is MODELED, and `SYMBOL_MAP` does not leave. Measured 2026-07-22.**
  The plan was "`SYMBOL_MAP`'s library half leaves the code generator and becomes typed l-lang".
  Measuring it changed the target. Of 43 entries:

  | | |
  |---|---|
  | **15 operators** | **language**, per W/D21 — found by dispatch, never by name. Can never be a library. |
  | **24 floor implementations** | the JS half of a floor entry. `SYMBOL_MAP` *is* the floor's JS backend, exactly as `runtime.c` is its C one. Deleting them deletes the JS backend. |
  | **4 orphans** | `iter`, `next`, `deep-copy`, `eval` — on no floor, in no spec. The actual work. |

  And 28 floor entries have **no** shim entry at all (`Math.*`, `console.*`, `Number`, `parseInt`…) —
  correctly, since those resolve to genuine host globals.

  `RuntimeProvider.isRuntimeFunction`'s own comment had already argued most of this half *cannot*
  leave, for better reasons than duplication: `get`/`head`/`elem` are the language's only producers of
  `T?`, and merely **declaring** them in a library silently deletes every optional check in the
  language, because `inferTotalAccessorType` disables itself the moment the name resolves to a symbol.
  `tail`/`empty`/`list`/`call` are loaded by the comptime sandbox and the REPL, which have no import
  pipeline.

  So the defect was never duplication — it was that **nothing checked the two halves line up**.
  `intrinsics.ts` derives C's view from the floor; the JS side had no such link, and a floor entry
  with no JS implementation was a `ReferenceError` found by running a program. `test:codegen` now
  checks both directions, plus that no operator ever acquires a floor entry.

  What the check found and what it cost:

  - **`iter`/`next`** were JS-only, so **the C backend had no iteration protocol at all** — a String
    or a hand-written `Iterable` *crashed the emitter*, and an `Iterable<T>` parameter compiled clean
    and trapped on data. Now on the floor, with `ll_iter`/`ll_next` and a protocol arm in `c-foreach`.
  - **`deep-copy`** is **not** D11's store copy: it recurses through arrays where the store copy
    shares them. C had only the store copy, so pointing the floor entry at it would have created a
    divergence *by the act of naming the operation*.
  - **`eval`** was the empty string, so on JS it compiled to the **host's** `eval` — evaluating
    JavaScript, not l-lang — and C refused it. Now LL0236 on both.
  - The **native member tables** merged the same way: 27 members byte-identical, 7 declared by the
    checker and refused by C, and three of those seven C could already do *dynamically* — so typing
    the receiver had been **losing** capability.
- ✅ **Lc — `std/llang/reflect`, the RTTI half of l-lang's self-description.** A library over an
  existing floor: no backend change, no new primitive, byte-identical on both backends from the first
  commit. It exists because a raw metadata index gets three things wrong. **Totality** — a
  descriptor's shape depends on its kind, so `t["extends"]` raises a D9 KeyError on a *root* class and
  `t["params"]` on anything that is not a function; every accessor here answers nil or `[]` instead,
  which is what makes them composable. **Inheritance** — `(type-by-name "Dog")` lists Dog's *own*
  methods, so any `has-method` that does not walk the `extends` chain is wrong for every inherited
  member; `methods` and `all-method-names` are named for which they are. **The edge is a name** —
  climbing is a by-name lookup, and nobody should have to know that to ask for a parent.

  Typed `Any`, deliberately: D42 conformance is checked against *declared* types, and a map the
  runtime mints declares nothing, so a `definterface TypeInfo` over it would be an unverifiable claim.
  The *returns* are typed as tightly as the data allows. `name-of`/`kind-of` are also the portable
  answer to the question `lib/std/types` answers with `x.constructor.name`, `Array.isArray` and
  `typeof` — three host spellings that work on one backend.

  The **AST half of `std/llang` is still blocked**, and not on effort: the `llang` backend is untested
  and cannot be trusted, which removes the `quote → datum → emit → compare` round trip that would have
  been its oracle.
- ✅ **Le — `std/core` exists; `std/types` / `std/string` / `std/async` move into it.** Grouping, not
  rewriting: `lib/std/core/{types,string,async}.lisp`, imported by full path (`std/core/string`)
  exactly as `std/io/files` and `std/sys/timers` already are. `format-args` moves with them — it was
  private to `std/io` with one caller, and it is not an I/O operation at all: it takes a template and
  a vector and answers a String. `std/io` imports it now, which is the honest direction.

  > **A resolver footgun this exposed, recorded rather than fixed.** `PackageRegistry.resolve`
  > answers a *package* import with **one** entry file: the source whose basename matches the
  > package's last name segment, and otherwise **`files[0]`** — the first source, alphabetically. So a
  > bare `(import "std/core")` neither fails nor imports the package; it silently resolves to
  > `async.lisp`. Full-path imports are unaffected — they never reach the package registry, falling
  > through to the bare-path search. Either an ambiguous package import should be a diagnostic or a
  > package should declare an entry point; both are compiler changes, not layout ones.

- **Sf — the cstd-shaped modules**, typed, and **actually tested**: goldens, `status: "test"`.
- **Sg — retire** what remains; close D7.

### Not in this phase

- **`eval` is the empty string.** A real `eval` needs a runtime AST interpreter. That is a phase of
  its own, not a stdlib module.
- **Quasiquote / unquote do not exist.**
- **Namespace imports** parse and dead-end. Either implement them or delete the grammar rule.

---

## 5. A note on why none of this was caught

`test:type-errors` counts corpus diagnostics **only on files marked `status: "test"`**. Files marked
`library` or `xfail` are excluded from the count entirely. The standing "0 corpus diagnostics"
claim is therefore a claim about *test* files; the true corpus total is **115, across 6 files**.

The entire `std/` tree is marked `library` — **compiled, never run**. That is precisely why a
stdlib that calls four nonexistent functions, defines `Number` twice, and leaks nine unexported
symbols has been sitting in the tree, green, the whole time.

**A test that is compiled but never executed asserts nothing.** Sf's `status: "test"` is not
bookkeeping; it is the point.

# The l-lang standard library — the standard

> **Status: the standard, not the library.** Nothing here is implemented yet. This document is the
> inventory of what the language *already implicitly promises*, the rulings that turn those promises
> into a specification, and the worklist that Phase S executes against.
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
| `20-stdlib/test_stdlib.lisp` | `abs min max pow ceil floor round inc` | `std/math.lisp` |
| `20-stdlib/complex_math_test/main.lisp` | `Complex` | `std/math.lisp` |

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
| `std/string` | `string.h` | `string-length substr split join trim starts-with ends-with` |
| `std/char` | `ctype.h` | `is-alpha is-digit is-space upcase downcase` |
| `std/time` | `time.h` | `now clock sleep` |
| `std/os` | `unistd.h` | `args env exit` |
| `std/seq` | *(none)* | `map filter reduce zip range` — pure l-lang, built on the above |
| `std/fn` | *(none)* | `identity compose partial constantly` |

**This ratifies a drift rather than imposing a shape.** The existing corpus has already wandered
toward cstd on its own, without anyone deciding to:

- `math.lisp` is already ≈ `math.h` — `sqrt sin cos tan log exp pow abs floor ceil round min max`
- `strings.lisp` already uses **literal C names**: `strlen`, `substr`
- `io.lisp`'s `print`, with its `{0}` placeholders, **is a `printf`**

The two modules with no C counterpart (`seq`, `fn`) are the honest exceptions, and are marked as
such: they are the higher-order layer, written in l-lang, on top of everything else.

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
- **Sc — the import side.** `(import "std/math")` resolved by name (a real resolution layer at the
  single choke point, with a search path); an unresolvable import is a **diagnostic, not an ENOENT**
  (**LL0217**); and a **selective** import binds only what it names (**LL0216** — moved here from Sb:
  `exportName` is the *export* side, `ImportDefinition.symbols` is the *import* side, and they share
  no code).
- **Sd — ambient globals become declarable.** Kills the `JS_GLOBALS` allowlist and, with it, the
  104 hidden p5js diagnostics. This is the one that actually *hides the JS*: `console` and `Math`
  become **typed** instead of **waved through**.
- **Se — `std/core`.** `SYMBOL_MAP`'s library half leaves the code generator and becomes typed
  l-lang. D9's optionals already make `head`/`first` typable honestly (`T?`) — that was the stated
  reason D9 had to precede D7.
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

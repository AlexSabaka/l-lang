# 🔌 l-lang reference — the floor, the ambient names, and the library

> **There are three layers, and the difference matters.** Almost every question of the form *"where
> does `map` come from?"* is really a question about which of these it lives in.
>
> | layer | what it is | where it is defined | do you import it? |
> |---|---|---|---|
> | **1. The intrinsic floor** | 72 runtime primitives both backends must implement **identically**, specified once so they cannot drift | `src/compiler/floor/floor.ts`, specified in [`spec/FLOOR.md`](spec/FLOOR.md) | no — always there |
> | **2. Ambient names** | forms and types the language itself provides | the compiler | no |
> | **3. The standard library** | 17 packages / 38 modules of **l-lang source** | `lib/std/`, ruled in [`spec/STDLIB.md`](spec/STDLIB.md) | **yes** — `(import "std/…")` |
>
> A library module is written in l-lang and compiled like your code, so it runs on **both backends**
> by construction. Layer 1 is where a backend *can* diverge, which is exactly why it is specified.

---

## 1. The intrinsic floor

Not importable, not shadowable. If a primitive is here, both backends implement it and the
[floor spec](spec/FLOOR.md) says what it must return — including the awkward cases (codepoints vs
bytes, `Int` wrap, `Real` formatting).

| group | entries |
|---|---|
| output | `console.log` `console.error` `display` `write-string` `write-string-err` |
| numbers | `Number` `parseInt` `parseFloat` `isNaN` `isFinite` |
| math | `Math.sqrt` `.log` `.exp` `.sin` `.cos` `.tan` `.asin` `.acos` `.atan` `.atan2` `.hypot` `.abs` `.floor` `.ceil` `.round` `.pow` `.min` `.max` `.random` `.sign` `.trunc` |
| sequences | `get` `head` `tail` `empty` `elem` `list` `call` |
| maps | `map-get` `map-set` `map-has` `map-delete` `map-keys` |
| text (codepoints, not bytes) | `codepoint-length` `codepoint-at` `string-from-codepoints` `string-to-codepoints` |
| bits (D61) | `band` `bor` `bxor` `bnot` `shl` `shr` `ushr` |
| iteration | `iter` `next` `dispose` |
| reflection | `type` `type-by-name` |
| system | `sys-arg` `sys-env` `sys-exit` `clock-ns` `sleep-ns` |
| files | `file-open` `file-close` `file-read` `file-write` `file-exists` |
| internal | `deep-copy` `__refine_check_int` `__refine_check_real` |

The live list is `src/compiler/floor/floor.ts`, and a conformance check keeps the backends against it.

## 2. Ambient names

Available with no import: the special forms (`let` `mut` `fn` `if` `when` `cond` `for` `while`
`match` `try` `return` `import` `export` …), the declaration forms (`defclass` `defstruct`
`definterface` `deftype` `defcast` `defmodifier` `defattribute` `defenum`), the condition system
(`restart-case` `handle` `signal` `invoke-restart`), and the built-in types:

`Int` `Real` `String` `Char` `Boolean` `Void` `Any` `Nil` — plus the constructed forms `T?`,
`A | B`, `A & B`, `[A B]` (tuple), `{:f <- T}` (record), `T[]`, `T<U>`.

The **error tower** is ambient (D62): `Error` → `ValueError` → `KeyError` / `IndexError` /
`TypeError`, each carrying a `cause`.

### Optionals — `T?`

`T?` is the type that also admits `nil`. Dereferencing one without checking it first is a compile
error (`LL0205`), so the check is not advice — it is the only way to get at the value.

```lisp
(fn describe [c <- String?] -> String
    (if (== c nil)
        (return "empty"))
    ;; From here to the end of the block, `c` is known to be a String.
    (return (+ "holding: " c)))
```

The guard is believed for the **rest of the block** once its branch exits (`return` or `throw`). It
works on a field too, not only on a bare name:

```lisp
(defclass Cache
    (mut :private :ctor value <- String? nil)

    (fn get-or [fallback <- String] -> String (
        (if (== this.value nil)
            (return fallback))
        (return this.value))))
```

### Visibility

The three levels are package-scoped (a package is a `package.yaml` compilation unit):

```lisp
;; Public -- exported; crosses the package boundary. Via (export ...), or the :public modifier.
(fn :public get-value [] ...)

;; Internal -- the DEFAULT (unexported): visible within the package, not to importers.
(fn :internal helper [] ...)

;; Private -- file-scoped (or, for a class member, type-scoped). ENFORCED: a cross-file/outside
;; reference to a :private name is LL0206.
(fn :private internal-only [] ...)
```

`protected` was **removed** from the language (it was a no-op, and the implementation-inheritance leak
Go/Rust drop) — `:protected` is now rejected as an unknown modifier (LL0015).

## 3. The standard library

`(import "std/…")`. Written in l-lang, so it runs on both backends.

### std/core

| module | exports |
|---|---|
| `std/core/protocols` | `Comparable` `Hashable` `Formattable` `Ring`, `compare` `hash-of` |
| `std/core/errors` | the typed error tower (D62) |
| `std/core/builder` | `StringBuilder` — because `+` in a loop is quadratic (D76) |
| `std/core/string` | ASCII classes, search, split/join, trim, case, parsing |
| `std/core/types` | type predicates |
| `std/core/async` | `Awaitable` `Task` |

### Collections & iteration

| module | exports |
|---|---|
| `std/seq` | eager, collection-**last**, array in/array out: `range` `zip` `map` `filter` `reduce` `flatten` `reverse` `sort` `sort-by` `min-by` `max-by` `index-of` `includes` `first` `last` `at` `length` |
| `std/iter` | `Iterable` `Iterator` `Disposable` `Range` — the protocol (D30) |
| `std/iter/linq` | lazy, collection-**first**, pipe-surfaced: `map` `filter` `enumerate` `concat` `skip` `skip-while` `flat-map` `take` `take-while` `zip` `to-list` `reduce` `count` `for-each` |

> **Two `map`s with different argument orders is deliberate** (D33), not a smell. `std/seq`'s runs
> now and hands back an array; `std/iter/linq`'s builds a generator that does nothing until pulled,
> so a chain over an infinite sequence still terminates.

`index-of` and `includes` search by **structural** equality — the same `==` the language uses — so a
freshly written `[1 2]` is found in a list of vectors. The native `.indexOf` / `.includes` members
compare containers by *reference* and are host interop, not the language's answer. A miss is `nil`,
not `-1`, matching `first`/`last`/`at`.

The `std/seq` operations **return new sequences and never mutate their argument** — `(reverse xs)`
leaves `xs` alone. `sort` and `sort-by` order by the language's own `<` (numbers numerically,
strings lexicographically) and are **stable**: elements that compare equal keep their input order.

### Math

| module | exports |
|---|---|
| `std/math` | the scalar umbrella — `Math.*` wrappers, `E` `PI` `TAU` |
| `std/math/complex` | `Complex`, `rect` `polar` `scale` `I` |
| `std/math/rational` | `Rational`, `from-int` `from-real` |
| `std/math/vector` | `Vec2` `Vec3` `Vec` |
| `std/math/stats`, `elementary`, `special`, `integrate`, `constants` | statistics, elementary and special functions, quadrature and root-finding |
| `std/math/random` | `Random` `default-random` — seeded xoshiro256\*\*/SplitMix64; **determinism is the API** (D65) |
| `std/math/symbolic/expr` | symbolic expressions |

### Text, time, system

| module | exports |
|---|---|
| `std/text/json` | `to-json` `to-json-pretty` `parse-json` `try-parse-json` `JsonParser` (D77) |
| `std/text/regex` | `first-match` `is-match` `find-all` `count-matches` `RegexMatch` — an l-lang engine (D67) |
| `std/time/calendar` | proleptic Gregorian civil time, UTC (D78) |
| `std/sys/path` | `Path` `PathLike` — a value type, `/` canonical (D64) |
| `std/sys/process` | `args` `env` `is-env-set` `env-or` `exit` |
| `std/io` | `print` `prn` `alert`; plus `std/io/console`, `std/io/files`, `std/io/stream` |
| `std/log` | a logger takes a `Clock`; an event is a name plus properties (D79) |
| `std/cli` | `Opt` `Command` `Cli` `ParseResult` `new-result` `parse` `help-text` `run` (D80) |
| `std/test` | `assert` `assert-eq` `assert-ne` `test` `run-tests` |
| `std/fn` | `identity` `constantly` `partial` `compose` |
| `std/debug` | `dbg` `inspect` `dump` `panic` `assert` `unreachable` `todo` |
| `std/llang/reflect` | the typed surface over the RTTI graph |

### Backend availability

Two things are **not portable**, by construction:

- **`std/js`** — the `:extern` escape hatch to host JavaScript. JS backend only, by definition.
- **`std/fn`**'s `partial` / `apply` are still host calls (`func.apply`, `funcs.reduceRight`), so
  they do not lower on C. Tracked in [`roadmap.md`](roadmap.md).

Everything else above compiles on both. Five corpus files are refused by the C backend on purpose;
`src/test/c-status.ts` is the live list, and a refusal is always an `LL0105`–`LL0107` that says what
it cannot do rather than emitting something wrong.

---

## Where this table comes from

Read off each module's `(export …)` form. **It is hand-transcribed, and that is a known weakness** —
the export lists are machine-readable and this page is not generated from them, so it can drift. If
you need certainty, the module source is one command away:

```bash
grep -h '(export' lib/std/text/json.lisp
```

Generating this page is recorded in [`roadmap.md`](roadmap.md)'s Known gaps, alongside the
diagnostics index, for the same reason: the loop that produces contracts should produce their
documentation too.

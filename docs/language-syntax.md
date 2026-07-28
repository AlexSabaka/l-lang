# 🦥 l-lang syntax

*Active development. Syntax changes when a better idea materializes — and when it does, it is
[ruled](spec/DECISIONS.md) first.*

> **How to read this.** Every section names a program in `examples/` that uses the form. Those
> programs are the end-to-end suite: compiled and run by **both backends**, diffed against one
> golden. So the citation is not decoration — it is the reason the claim can be trusted, and if a
> form here stopped working the build would be red before this page was wrong.
>
> **The authority is [`spec/GRAMMAR.ebnf`](spec/GRAMMAR.ebnf)**, generated straight off the parser
> by `npm run grammar:ebnf`. This page is prose about that grammar; where they disagree, it wins.

---

## 0. What kind of language this is

Everything is an S-expression, and everything is an expression — `if`, `match`, `for`, a block all
yield values.

But **l-lang is not a Lisp with types bolted on**, and it is worth being honest about that up front.
A Lisp decides what a list means by looking up its head; l-lang decides by **parsing**. The grammar
declares 98 productions and 51 keyword tokens, and **23 of those productions are pure type
machinery** — `deftype`, `defcast`, refinements, dimensions, unions, intersections, tuples,
generics, variance. Remove the parentheses and what is left reads closer to Kotlin or Rust than to
Scheme.

The corollary matters when you write l-lang: reach for the type system, not for macros. There are no
macros — `defmacro` and `defsyntax` are reserved and refused (**LL0023**), the tiers are designed
(D69) and the grammar is not built.

---

## 1. Basics & comments

```lisp
;; A line comment.

(
    ;; A program is a list of forms.
    (console.log "hello")
)
```

A comment **occupies no slot** — it is not a value, and it cannot be an argument (D83). That sounds
obvious and was not: it was ruled after a comment in an argument position shifted everything after
it.

> `examples/00-basics/`, `80-adversarial/comment_in_value_position.lisp`

## 2. Variables & mutability

```lisp
(let x 10)                  ;; bound once
(mut counter 0)             ;; rebindable
(counter := (+ counter 1))  ;; `:=` assigns; `+= -= *= /= %=` compound

(let name <- String "Ada")  ;; with an annotation
```

`let` is **binding-immutable** (D10, the Rust reading): the name cannot be rebound. Assigning to one
is **LL0233**. It says nothing about the interior of what it points at.

> `examples/00-basics/00_vars.lisp`, `00-basics/03_optional_and_mutability.lisp`

## 3. Data structures

```lisp
(let v [1 2 3])                       ;; vector
(let m [1 2 | 3 4])                   ;; matrix — `|` separates rows
(let map { :name "Ada" :age 36 })     ;; map; keys are strings, never mangled (D13)
(let t [1 "two"])                     ;; tuple type [Int String]
(let r {:name <- String})             ;; record type
```

A matrix literal has a type, and its cells must share a **`Ring`** — a type answering `+` and `*`
(D89). `[1 "a" | 2 3]` is **LL0246**.

> `examples/05-data-structures/`, `40-math/`

## 4. Functions & pipelines

```lisp
(fn add [x <- Real y <- Real] -> Real (return (+ x y)))

(let result-a
    (5
     |> (sub 7)
     |> (add 1)
     |> square))
```

`|>` carries left, `<|` carries right. A bare `|> .length` selects a member.

> `examples/01-functions/04_pipelines.lisp`

## 5. Modifiers

`:name` before a declaration. **The same sigil is three different roles** (D68), which is worth
knowing because the spelling does not tell you which:

| role | what it is | example |
|---|---|---|
| **modifier** | a built-in property of the declaration | `:async`, `:gen`, `:public`, `:extension`, `:comptime` |
| **decorator** | a user-defined transform, declared with `defmodifier` | `:memoized`, `:logged` |
| **attribute** | inert data, declared with `defattribute` | `:docstring["…"]` |

A decorator's contract is **flat** with a setup slot (D75), and its arguments must be compile-time
constants (**LL0036**).

> `examples/10-modifiers/`, `07-types/08_attributes.lisp`

## 6. Control flow

```lisp
(if cond then-expr else-expr)
(when cond body)
(cond (test-1 result-1) (test-2 result-2) (:else fallback))
(for :each x :from xs :then body)
(while cond body)
```

All of them are expressions. `return` returns from the **function**, not from the form (D40).

> `examples/02-control-flow/`, `03-loops/`

## 7. Pattern matching

```lisp
(match value {
    0                    => "zero"
    n :when (< n 0)      => "negative"      ;; guard (D26)
    x :of String         => "a string"      ;; type pattern (D27)
    [a ...rest]          => "a vector"      ;; rest pattern (D28)
    r"ca+t"              => "a regex arm"   ;; (D67)
    _                    => "anything"
})
```

> `examples/04-pattern-matching/`

## 8. Types

```lisp
(deftype Name <- String)                        ;; a nominal newtype
(deftype uint8 <- Int :satisfies (0..255))      ;; a refinement — bounds the compiler checks
(deftype :unit Meter <- Real)                   ;; a unit of measure
(deftype Speed <- Real :satisfies (/ Meter Second))

(defcast :implicit [c <- Complex] -> Real ...)  ;; a declared conversion
(cast<Real> c)                                  ;; the explicit use site
```

**Types are nominal; interfaces are structural** — the Go model (D42). A refinement is checked at
every boundary. A `:unit` composes through `*` and `/`, refuses to cross under `+`/`-`, and
**erases** — no runtime check is emitted from a dimension.

Note `..` **binds by adjacency**: `(0..255)` is a range, `(0 .. 255)` is three things and a
standalone `..` is **LL0034** (D88).

> `examples/07-types/`, `16-stdlib/26_units.lisp`, `80-adversarial/unit_dimensions.lisp`

## 9. Classes, structs & interfaces

```lisp
(definterface Node
    (fn eval [] -> Real)
    (fn show [] -> String)
)

(defclass Num :implements Node
    (let :ctor value <- Real)
    (fn eval [] -> Real (return this.value))
)

(defstruct Point (let :ctor x <- Real) (let :ctor y <- Real))   ;; value semantics (D11)
```

There is **no `protected`** — the implementation-inheritance leak Go and Rust both drop. Visibility
is `public` / `internal` / `private`, scoped to the **package** (D35). A struct is copied into a
collection slot; a *native* member call like `.slice` is an escape hatch and aliases (D50).

> `examples/09-oop/`, `06-value-semantics/`

## 10. Generics

```lisp
(fn :comptime max<T> [a <- T b <- T] -> T (if (> a b) a b))
(defclass Box<T> (let :ctor value <- T))
```

Generics are **real, not erased** — they are inferred by solving, then checked against the solution.

> `examples/08-generics/`

## 11. Strings

```lisp
"plain"
'"interpolated {(name)}"      ;; alias for f"…"
f"interpolated {(name)}"
r"a raw\string"               ;; no escape processing — the regex spelling (D67)
```

Escapes decode identically everywhere, including inside a match pattern (D74).

> `examples/17-strings/`, `16-stdlib/20_regex.lisp`

## 12. Errors, and conditions

```lisp
(try body (catch e handler) (finally cleanup))

(restart-case
    (if (== k 1) 100 (invoke-restart :use-default 0))
    (:use-default [v] v))               ;; a resumable second mechanism (D47)
```

A **data** error is catchable; a **contract** violation is not (D82, D87). Conditions and restarts
are native on C and refused on JS with **LL0108**.

> `examples/18-error-handling/`, `19-conditions/` (21 programs)

## 13. Modules

```lisp
(import "std/io")
(import "std/math" :as m)
(export foo bar)
```

The compilation unit is a **package** — a `package.yaml` — and visibility is package-scoped (D35).
`:as` binds on both sides.

> `examples/15-modules/`, `80-adversarial/import_export_aliases/`

## 14. Generators & async

```lisp
(fn :gen counter [] -> Iterator<Int> (while true (yield 1)))
(fn :async fetch [] -> Task<String> ...)
```

`:gen` lowers natively on C. **`:async` is refused on C by ruling** (D60) — it is not an oversight.

> `examples/13-generators/`, `14-async/`

## 15. Compile-time evaluation

```lisp
(fn :comptime square [x] (* x x))
```

Folded before codegen by an **in-house interpreter** (D73) — not by the host, and not by `node:vm`.
Nondeterminism and runaway folds are refused with locations.

> `examples/11-comptime/`

## 16. Conventions

- **kebab-case** for names; `is-x` for predicates. Scheme spellings (`nil?`, `set!`) are rejected (D21).
- A `.expect` golden is **authored from intent**, never captured from output.
- Adversarial examples land with every change — `examples/80-adversarial/` is 90 programs and the
  reason most of this page can be trusted.

---

## What is not here

Documented so you do not go looking:

| | |
|---|---|
| `defmacro` / `defsyntax` | reserved, refused (**LL0023**). D69 rules the tiers; the grammar is unbuilt. |
| `eval` | **LL0236** — it needs a runtime AST interpreter, which is a phase of its own. |
| quasiquote / unquote | do not exist. |
| `:where` bounds | the token lexes; no parser rule consumes it. Phase Bg. |
| `array[1 .. 2]` spans | does not parse — a syntax error in indexer position, not a diagnostic. |
| `fn` parameter defaults | unbuilt. |
| boolean match patterns, `:is` patterns, sized array types | unbuilt. |

The live list is [`roadmap.md`](roadmap.md)'s Known gaps.

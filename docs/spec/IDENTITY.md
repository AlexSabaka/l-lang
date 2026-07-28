# What l-lang is, what it is not, and where it is incoherent

Ninety rulings exist and none of them says what the language *is*. `DECISIONS.md` answers "why is
this form like that"; the guides answer "how do I write it". Nothing answers "what am I looking
at" — and the honest answer is more interesting than the feature list that stood in for it.

Everything below is measured on the tree at 2026-07-28. Where a number appears, the command that
produced it is nearby.

---

## 1. What it is

**A statically typed, natively compiled language whose surface happens to be S-expressions.**

Not "a Lisp with types". That distinction is not pedantry — it predicts where the work goes and who
the documentation should be addressed to.

### The measurement

`Parser.ts` declares **98 productions**. `tokens.ts` defines **51 keyword tokens**. `ast.ts` declares
**86 node types**. R7RS Scheme has about eleven syntactic keywords and a reader that produces one
datum type.

The decisive tell is `src/compiler/analysis/listForm.ts`, where `SPECIAL_FORMS` holds exactly twelve
names:

```
return  new  throw  quote  await  yield  typeof  delete  in  instanceof  this  super
```

**None of them is a Lisp special form.** There is no `lambda`, no `define`, no `if`, no `let` in that
set — because those are *keyword tokens with dedicated productions*. A Lisp decides what a list means
by looking up its head; **l-lang decides by parsing**.

And **23 of the 98 productions are pure type machinery** — `type`, `unionType`, `intersectionType`,
`basicType`, `simpleType`, `typeName`, `genericType`, `functionType`, `mapType`, `tupleType`,
`typePattern`, `typeDefDecl`, `typeRef`, `genericParam`, `modifier`, `modifierDefDecl`,
`refinementConstraint`, `dimensionConstraint`, `dimensionOperand`, `castDefDecl`, `castExpr`,
`keyTypeDefinition`, `mapKeyType`. A Lisp has zero of these.

### What that makes it, concretely

Remove the parentheses and the feature list reads Kotlin/Rust/F#:

| feature | where it came from |
|---|---|
| nominal types, structural interfaces | Go, explicitly (D42) |
| `let` as binding-immutability | Rust (D10) |
| value-semantic structs | Val / Hylo (D11) |
| refinement newtypes — `<- Int :satisfies (0..255)` | the refinement-types line, checked at boundaries (D46) |
| **units of measure** — dimensions that compose and erase | F# (D90) |
| `defcast :implicit` / `:explicit` | Rust's `From`/`Into` with C++'s `explicit`, and D46 cites the C++ mistake by name |
| protocols as traits — `Comparable`, `Hashable`, `Formattable`, `Ring` | D63, D89 |
| declaration-site variance, `?` optionals, extension methods, package visibility | C#, Kotlin, Swift, Rust |
| conditions and restarts | Common Lisp (D47) — the one deep borrowing from the Lisp side |

The parentheses and the `'` reader are the only Lisp left in the *surface*. The condition system is
the only place where a Lisp *idea* is load-bearing.

---

## 2. What it deliberately is not

**This is the part that has never been written down, and its absence is the reason the language
reads as "trying to be everyone".** A search across 13,000 lines of documentation for a statement of
non-goals returned two incidental hits. The only identity statement the project had was an
eight-bullet, all-additive feature list — and an all-additive list is precisely what reads as
unprincipled.

The refusals are systematic, argued, and enforced with diagnostic codes:

| refused | why | enforced by |
|---|---|---|
| **`protected`** | the implementation-inheritance leak Go and Rust both drop | LL0015 — rejected as an unknown modifier |
| **macros in 1.0** — `defmacro`, `defsyntax` | the tiers are ruled (D69), the grammar is not built, and a half-macro is worse than none | LL0023, refused by name |
| **host `eval`** | it needs a runtime AST interpreter, which is a phase of its own; on JS it used to silently become *JavaScript's* `eval` | LL0236 |
| **finalizers, ever** | JEP 421, `SafeHandle`, Go's `SetFinalizer`, Rust's `Drop` — the prior art is unanimous (D59) | ruled ahead of the collector |
| **a narrowing cast** | a cast that lies about a value is worse than a check; `:of` narrows soundly and `defcast` converts explicitly | D41 + D46/B-3 |
| **implicit cast *to* a refined type** | D46 cites the C++ mistake directly | — |
| **Scheme spellings** — `nil?`, `set!` | one naming convention, chosen (D21) | — |
| **`apply` as an export** | it collides with method dispatch | deliberately unexported from `std/fn` |
| **a GC in the C runtime, for now** | *"a probe that debugs a garbage collector has failed its purpose"* — it mallocs and leaks on purpose | `runtime.c` |
| **unit-polymorphic functions** (`fn sq<'u>`) | F#'s research half; D90 stops one step short | D88/D90 |
| **`:async` on C** | by ruling, not by omission | D60 |

That table is a better statement of what this language is than any feature list, and it is five
sentences long.

---

## 3. Where it is incoherent

### 3.1 Homoiconicity is half-achieved, and the missing half has a diagnostic code

The README led with *"Code is data. Data is code."* for months. The truth is more precise and more
interesting.

**The representation half is real.** `ast.ts` declares `QuoteNode extends ASTNode<"quote">` — a
genuine compiler node, not a parallel datum type — and `LowerAstToHirVisitor` protects it: *"`quote`
is DATA, not evaluated — never lower its operand."* D3d records that quote used to compile to
`JSON.stringify(node)`, which was code-as-**text**, i.e. code-as-nothing; it now emits an object you
can walk. That is more than most statically typed languages have.

**The return trip does not exist.** `eval` is **LL0236**, whose message names the blocker exactly:
*"it needs a runtime AST interpreter, which the language does not have — it is a phase of its own,
not a stdlib function."* `defmacro` and `defsyntax` are **LL0023**. And on the reference backend it
is worse than absent: `grep quote src/compiler/codegen/c/` finds no quote path at all, and the sole
homoiconicity demo — `examples/12-quote-macros/00_quoting.lisp` — is `xfail` and absent from
`c-status.ts`. **It does not run on the specification backend.**

That example is also the sharpest single piece of evidence in the tree, because of *how* it reaches
for the data: `(head expr.nodes.nodes)`. That is not homoiconicity; that is a user indexing into the
compiler's internal representation.

**And the ruling that would settle it has no D-number.** It lives in `src/test/manifest.ts` as an
`xfail` reason:

> *"Which of those homoiconicity means is a language decision, not a bug; the ruling taken
> 2026-07-22 is BOTH, with the AST datum as the source of truth and cons/list a derived layer."*

Ninety rulings have been minted, and the one governing the project's headline claim is a string in a
test ledger. **It should be a D-number.**

### 3.2 The surface barely moves; the contracts churn

The instinct is that a young language grows by adding syntax. Measured over the last 60 commits
(`c3979f5..HEAD`), the parser went from **93 productions to 98**, and the five additions are
*exactly*:

```
attributeDefDecl   castDefDecl   castExpr   dimensionConstraint   dimensionOperand
```

**Zero new expression forms. Zero control forms. Zero binding forms.** All five are type-contract
machinery.

Over the D75→D90 window the ratio is starker. The entire grammar surface — `Parser.ts`, `tokens.ts`,
`ast.ts` together — moved **+120/−11 lines**. Everything else moved **+5942/−402 across 113 files**,
of which `DECISIONS.md` alone is **+1038**. By commits touching each area: `grammar_v2` **3**,
`src/compiler/types` 9, `lib` 12, `examples` **26**, `src/test` **35**.

Of the sixteen rulings in that window: **five are pure stdlib with no syntax at all** (D76–D80),
**eight are pure contract over syntax that already existed** (D75, D81–D87), and three touch the
grammar — each of those carrying far more contract than surface.

**This inverts the maintenance problem the documentation was built for.** The surface is stable
enough to document — five productions in sixty commits — yet every reader-facing document was a
*surface reference*, and all of them were stale. The contracts churn hard, and prose references hold
contracts badly while **diagnostics hold them well**: a contract that is not enforced by a code is
undocumented by construction, and one that is enforced already explains itself at the point of
failure.

The strategic reading: **stop hand-maintaining prose references; let the loop's own output be the
documentation.** A generated diagnostics index (97 codes, one page, linked from every error message)
plus generated stdlib export tables would cover more surface, more accurately, at zero drift, than
1,489 lines of hand-written reference managed today.

### 3.3 "Does X implement interface I" has four answers

Not a doc bug — a design one, and each site is individually defensible:

| asked by | answered | ruling |
|---|---|---|
| the checker, for assignability | **structurally** — having the members is implementing it | D42 |
| `(x :of I)`, `display`, `compare`, `hash-of` | **nominally** — a declared `:implements` only | D63 |
| `for :each` element typing | nominally, via `implementedInterfaces` | D30 |
| disposal | by matching the member **name** `dispose` | D58 |

D63 is explicit that this is deliberate — display is gated nominally *"NOT on 'has a method named
`format`', so an unrelated method of that name never hijacks rendering"*. Correct in isolation. The
consequence taken together is that **a class conforming by shape is accepted by `[x <- Ring]` at
compile time and answers `false` to `(x :of Ring)` at run time.** Two answers to one question.
`examples/80-adversarial/ring_protocol.lisp` pins both halves so the day it moves is visible.

### 3.4 Rules that stop at arity two

`inferOperatorType` branches on one operand and on two, then falls through to `unknown()`. Both
D90's dimension rule and D88's promotion live inside the two-operand branch. So:

```lisp
(+ d t x)   ;; Meter, Second, Meter  ->  prints 114, silently
```

The two-operand form of the same expression is `LL0247`. N-ary arithmetic is ordinary l-lang —
`(- 10 1 2)` is the reading D90's own examples cite — so this is reachable, and no corpus file
exercised it.

It is the shape of the incoherence that matters more than the bug: **a rule was written for the
construct that motivated it rather than for the language.** The same question hangs over comparisons
and `%` across dimensions, which D90 deliberately left unruled.

### 3.5 The good documents were the unreachable ones

`FLOOR.md` and `STDLIB.md` open with the best convention in the tree — a dated status block naming
what is built and what is not — and before this sweep were linked from **nothing**. `DECISIONS.md`,
which declares itself the spec, was absent from the documentation index. The four documents a new
reader *was* routed to were the four an audit rated *rewrite*.

The cause is worth stating because it generalizes: **the accurate documents were written by the
person doing the work, as a byproduct of ruling. The inaccurate ones were written to be read.** The
first kind is produced by the same loop that produces the code, so it stays true. The second kind is
a separate artifact with no gate on it — and this project has invented enforcement for everything
*except* its documentation.

---

## 4. So what is it, in one paragraph

**l-lang is a statically typed, natively compiled language in S-expression clothing, whose real
subject is contracts — types, refinements, dimensions, protocols, visibility, and the diagnostics
that enforce them.** It borrows its object model from Go and C#, its binding rules from Rust, its
units from F#, its condition system from Common Lisp, and its parenthesis from Lisp — and of those,
only the last two are things a Lisp programmer would recognize as Lisp. It refuses more than it
accepts, and refuses on argued grounds. Homoiconicity is a stated goal that is half-built and, on
the reference backend, not built at all.

That is a coherent thing to be. It was simply never written down, and a feature list is what stood
in its place.

---

## Open, and deliberately not settled here

- **A D-number for the homoiconicity ruling** — §3.1. Minting rulings is not this document's job.
- **Comparisons and `%` across dimensions** — §3.4, and the arity question with it.
- **Reconciling the four conformance answers** — §3.3. A runtime-metadata change, not a checker one.
- **Whether the reference documents should be generated** — §3.2. Recorded in
  [`../roadmap.md`](../roadmap.md).

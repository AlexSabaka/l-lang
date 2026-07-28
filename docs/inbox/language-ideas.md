# Language ideas — parked & deferred

**Status: TRIAGED in the 2026-07 Sabaka⇄Dove design round.** The wishlist rescued from
the since-removed corpus file *W99_L_sloth_design_v1.lisp* has been sorted into decisions
and roadmap — the rulings now live
in `docs/spec/DECISIONS.md` (**D46–D48**) and `docs/roadmap.md` (**Phases Cv / Bg / Cr**). Long-form
reasoning: `docs/_archive/hir-design-round-brief.md` §C. **This file now tracks only the ideas still open —
parked or deferred.** Everything resolved is in the table below for the record, then closed there.

---

## Resolved (for the record — follow the pointer; don't re-litigate here)

| idea | disposition | where |
|---|---|---|
| Refinement / range types | **DONE** — `<- Int :satisfies (0..255)`, checked at every boundary | D46 / Phase Cv (B-1); `cacc912`, `38d1c79` |
| Native fixed-width ints (`uint8`…) | **Greenlit, still unbuilt** — the refinement landed, the native WIDTH did not | D46 / Phase Cv (B-2) |
| `implicit` / `explicit` cast operators | **DONE** as `defcast` + `(cast<T> x)` | D46 / Phase Cv (B-3); `ab92b9f`, `3985492` |
| `:where` relations (`:is` / `:extends` / `:implements`) | **Greenlit** — type-variable bounds only | Phase Bg; *not* for value refinements (D46 B-1b) |
| Generic `new()` / ctor constraints | **Greenlit** (low priority) | Phase Bg |
| C#-style attributes | **DONE**, with a different spelling and no `:with` — `(defattribute docstring [text <- String])` applied as `:docstring["…"]` via D68-a's adjacency gate | D72; `2ab30a5`, `e1455ba`, `6f2d24b`; `examples/07-types/08_attributes.lisp` |
| Flags enums (`:with Flags`) | **Greenlit** | Phase Bg |
| `\|> .method` selectors | **Greenlit** (desugar over the pipe) | Phase Bg |
| `with`-copy (`(with s :field v)`) | **Greenlit** | Phase Bg |
| `:readonly` fields | **Greenlit** | Phase Bg |
| `:stack` allocation | **Greenlit** — needs escape analysis | Phase Bg |
| Tuples | **Done** | Phase U (D37) |
| Type-guard patterns + `typeof` | **Done** as `:of` + `typeof`; `-> Type =>` arm **rejected** | D41 |
| Pattern zoo (constant / id / type / list / vector / map / rest) | **Done** | D26–D28 |
| `deftype` unions / intersections (`\|`, `&`) | **Done** (already expressible); `deftype :extends :is` shape **rejected** | D46 |
| Generic functions | **Done**; only *defaults* are new | roadmapped (`:=` + LL0211 + D9) |
| Instance-/static-by-dot | **Superseded** | D1 (dispatch by type) |
| Predicate / function match arms | **Rejected** (redundant with `:when`; fn-signature patterns dead) | D26 / Zc |
| `infix` escape hatch | **Rejected** (conflicts with `\|>`) | D33 |

---

## Parked & deferred (still open — may revisit; do **not** build as originally specified)

### Mapped types / `keyof` / `T[P]`
TS-style type-*computation* in a C#-semantics language — the worst fit of the bunch (it fights the
"elegancy is illusion" stance). **Not** a declarative type-level sublanguage. If ever wanted, only a
**restricted** form via comptime / macros, procedurally. Parked, not closed.

### Quoted-AST DSL / runtime `eval`
The LINQ-to-SQL-shaped `sql<T> '(SELECT …)` idea. Runtime `eval` fights the native endgame (it ships an
interpreter). The l-lang-native path is a **comptime macro** reading the quoted AST at compile time —
**blocked on the metaprogramming tier** (`defmacro` / `defsyntax`, still zero grammar — though **D69**
now RULES the three tiers by what each handler receives, so the design question is settled and only the
grammar is missing). Parked, reframed to compile-time. Independent of that path: the **homoiconicity
question** — is a quote a cons-list or an AST datum? — must be settled regardless. It is open in
`examples/12-quote-macros/00_quoting.lisp`, which is `xfail`; the answer taken 2026-07-22 is *both*,
with the AST datum as the source of truth and cons/list a derived layer, but **that ruling has no
D-number and lives only in `src/test/manifest.ts`'s xfail reason.**

### Provable refinements
The static-verification version of B-1: the checker discharges `0 .. 255` / a predicate at *compile*
time instead of at runtime. A **distinct verification project** (Liquid-Haskell / F* / Dafny-grade),
**same predicate syntax**, retrofitted later as an optimisation. Kept deliberately separate from the
runtime-checked substrate (D46): a refinement that cannot be discharged runs its check at runtime, full
stop — the moment the checker starts opportunistically discharging predicates, the SMT project has begun
without a decision to begin it.

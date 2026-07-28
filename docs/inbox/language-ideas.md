# Language ideas — parked & deferred

**Status: TRIAGED in the 2026-07 Sabaka⇄Dove design round.** The wishlist rescued from
`examples/W99_L_sloth_design_v1.lisp` has been sorted into decisions and roadmap — the rulings now live
in `docs/spec/DECISIONS.md` (**D46–D48**) and `docs/roadmap.md` (**Phases Cv / Bg / Cr**). Long-form
reasoning: `docs/_archive/hir-design-round-brief.md` §C. **This file now tracks only the ideas still open —
parked or deferred.** Everything resolved is in the table below for the record, then closed there.

---

## Resolved (for the record — follow the pointer; don't re-litigate here)

| idea | disposition | where |
|---|---|---|
| Refinement / range types | **Greenlit** | D46 / Phase Cv (B-1) |
| Native fixed-width ints (`uint8`…) | **Greenlit** | D46 / Phase Cv (B-2) |
| `implicit` / `explicit` cast operators | **Greenlit** as `defcast` | D46 / Phase Cv (B-3) |
| `:where` relations (`:is` / `:extends` / `:implements`) | **Greenlit** — type-variable bounds only | Phase Bg; *not* for value refinements (D46 B-1b) |
| Generic `new()` / ctor constraints | **Greenlit** (low priority) | Phase Bg |
| C#-style attributes | **Greenlit** as `:with Attr` + reflection; bracket `[Attr]` **rejected** | Phase Bg |
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
**blocked on the metaprogramming tier** (`defmacro` / `defsyntax`, still zero grammar). Parked, reframed
to compile-time. Independent of that path: the **homoiconicity question** — is a quote a cons-list or an
AST datum? — must be settled regardless (open in `04-data-types/01_quoting.lisp`).

### Provable refinements
The static-verification version of B-1: the checker discharges `0 .. 255` / a predicate at *compile*
time instead of at runtime. A **distinct verification project** (Liquid-Haskell / F* / Dafny-grade),
**same predicate syntax**, retrofitted later as an optimisation. Kept deliberately separate from the
runtime-checked substrate (D46): a refinement that cannot be discharged runs its check at runtime, full
stop — the moment the checker starts opportunistically discharging predicates, the SMT project has begun
without a decision to begin it.

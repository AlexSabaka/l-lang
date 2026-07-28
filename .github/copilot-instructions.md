# l-lang — AI development guide

**The contract lives in [`CLAUDE.md`](../CLAUDE.md) at the repository root. Read it first; this file
is a pointer, deliberately.**

It was 431 lines of architecture guide until 2026-07-28, and by then every load-bearing claim in it
was false. It documented a PEG.js grammar (`l-lang.pegjs`) retired by D39, a `codegen/js-legacy/`
directory deleted in the same ruling, a six-stage pipeline ending at JavaScript — while the HIR had
been inserted below codegen (D45/D48) and **C had become the reference backend** (D86) — and a test
suite of "27/65 examples with `.expect` files" against a corpus of 304. It also carried two
`Last Updated` footers, three weeks apart, because it was itself two documents concatenated.

That is the predictable outcome of maintaining two agent-facing documents by hand, and this one was
the more expensive of the pair to leave wrong: it is machine-consumed, so its errors were amplified
into generated code that reintroduced the deleted compiler. So there is one now, and this file points
at it rather than paraphrasing it.

## The short version

- **C is the reference backend** (D86). The JavaScript backend is a deprecated differential-testing
  oracle (D66). A change green on JS and untested on C is untested.
- **There is no `package.json` at the repository root.** Every `npm run` is from `src/`.
- **The gate is eleven commands plus the games suite**, not `npm test`. CI runs only `npm test`, on
  the deprecated backend, so green CI proves very little.
- **Never bless a golden.** `.expect` files are hand-derived from intent, never captured from
  compiler output.
- **`examples/` is the end-to-end suite**, 326 programs, and adversarial examples land with every
  change.
- **Language decisions are D-numbered** in `docs/spec/DECISIONS.md`, which is the spec.

All of it, with the enforcing file named beside each rule, is in [`CLAUDE.md`](../CLAUDE.md).

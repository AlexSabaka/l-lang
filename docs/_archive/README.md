# The archive

Documents that did their job. Nothing here is maintained, and nothing here should be read as a
statement about the current tree.

**Why they are kept rather than deleted.** Most of these are *briefs* and *recon* — the intel that
produced a ruling. The ruling lives in [`docs/spec/DECISIONS.md`](../spec/DECISIONS.md) and is
authoritative; what the brief still carries is the reasoning and the measurements behind it, which a
one-paragraph ruling cannot hold. When a future round reopens a question, this is where the previous
round's evidence is.

**How to read one.** Every file here opens with a banner naming the date it was archived and the
ruling that consumed it. Trust the banner and the D-number; do not trust the file's body against the
current tree. Several of them were written when l-lang transpiled to JavaScript and the C backend was
an experiment — a framing **D86 reversed**, so their verdicts about which backend is "right" are
inverted relative to the project today.

**If you are looking for something specific:**

| you want | it is at |
|---|---|
| what was decided, and why | [`docs/spec/DECISIONS.md`](../spec/DECISIONS.md) |
| what is built, what is left, what is broken | [`docs/roadmap.md`](../roadmap.md) |
| C backend defects, still-cited, still live | [`docs/spec/C-BACKEND-FINDINGS.md`](../spec/C-BACKEND-FINDINGS.md) |
| ideas parked but not ruled | [`docs/inbox/language-ideas.md`](../inbox/language-ideas.md) |

## Contents

| file | what it was | consumed by |
|---|---|---|
| `c-backend-gap-ledger.md` | §1–§8 of the probe record: the method, the A1–A9 dip counts (3287 across 60 files), the frontier | D48, D49, D50–D55; framing reversed by D86. §9–§21 promoted to `spec/C-BACKEND-FINDINGS.md` |
| `hir-design-round-brief.md` | the Sabaka⇄Dove round that ratified the coercion substrate, the ideas triage, and conditions/restarts | D46, D47, D48; amendments to D26/D33/D41 |
| `hir-llvm-readiness-report.md` | how far `HirModule` stood from the separation bar, and five open questions | all five answered in D46/D48 |
| `hir-gaps-and-seams.md` | an adversarial multi-agent review of the JS/LLVM split (31 findings, 22 confirmed) | absorbed into D45/D48; the type channel it called write-only is now load-bearing on both backends |
| `coroutines-and-memory-brief.md` | the measurements behind coroutines, the memory model, and async posture | D58, D59, D60 |
| `adversarial-probe-2026-07-27.md` | 29 C-backend defects + 20 RFC critiques | its own triage adjudicated these to 11 distinct defects; **its premise (JS is the oracle) is reversed by D86** |
| `adversarial-corpus-integration.md` | folding three external directories into `examples/` | superseded by `src/test/manifest.ts`; every path in it was renamed by the decade-block reorg |
| `dove-stdlib-roadmap.md` | an audit of `lib/std` and a ten-module Tier-1 build order | eight shipped as D64–D65, D67, D76–D80; the remainder is in `roadmap.md` |
| `stdlib-games-recon.md` | Dove's stdlib roadmap × the games findings, merged and re-measured | phases S1–S3 executed; §2.6 extracted to `STDLIB.md` §3.1 |
| `std-math-numerics-blockers.md` | the two blocked `std/math` numerics modules | `random` shipped (D65); `fft` is in `roadmap.md`, and its draft is lost |
| `regex-literals-recon.md` | the `/pattern/flags` literal, and why it cannot work | D67 — `r"…"` raw strings, an l-lang engine, `std/text/regex` |
| `rtti-and-cast-brief.md` | five research lenses on RTTI and whether a cast form should exist | D41 (`:of` narrows) and D46/B-3 (`defcast` converts) |
| `impl-notes-2026-01.md` | long-form `deftype`/`defstruct` and `defmodifier` implementation notes, concatenated onto the compiler guide | shipped; `defmodifier`'s contract replaced by D75 |
| `l-lang-rfc-0001.md` | "The l-lang Report" — a 2996-line prose consolidation of the whole language | never ratified; measured at 35% drift 48 hours after its own corrections pass. Appendix E extracted to `spec/PRIOR-ART.md` |

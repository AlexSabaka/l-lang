# inbox

Working documents that are **still live** — each holds something not yet captured anywhere
authoritative. This is not a pile; it is five files with a reason each, and a file leaves when its
reason expires.

| file | why it is still here | it leaves when |
|---|---|---|
| `adversarial-probe-2026-07-27-triage.md` | the adjudication of the 2026-07-27 audit. Six of its eleven defects are open, and four divergences are still unruled | the six are pinned by files in `examples/80-adversarial/` and the four get D-numbers |
| `hir-brief.md` | **the compiler cites it.** Its R1–R6 are named by five source comments in `src/compiler/hir/` and `codegen/` | never, unless those five comments move in the same commit |
| `hir-llvm-consumption-spec.md` | **the compiler cites it.** Its A1–A9 taxonomy is what the live `GapLedger.ts` records dips in | never, on the same terms |
| `compiler-notes-from-repl.md` | **eight source comments cite its path**, and two of its items are still open | those two close and the eight citations are repointed |
| `language-ideas.md` | the only register of ideas that are parked but not ruled | each remaining idea is ruled or dropped |

Everything else that used to live here is in [`../_archive/`](../_archive/README.md), with a banner
naming the ruling that consumed it.

**Where things went.** The generated grammar is now [`../spec/GRAMMAR.ebnf`](../spec/GRAMMAR.ebnf).
The C backend's live findings log is
[`../spec/C-BACKEND-FINDINGS.md`](../spec/C-BACKEND-FINDINGS.md). RFC-0001's prior-art appendix is
[`../spec/PRIOR-ART.md`](../spec/PRIOR-ART.md).

## The rule for adding something here

A document belongs in `inbox/` only if it holds live work that is **not** already in
[`DECISIONS.md`](../spec/DECISIONS.md) or [`roadmap.md`](../roadmap.md). If a ruling has absorbed it,
the ruling is the record — archive the brief and point at the D-number. Recon that has been acted on
is history, and history goes in `_archive/`.

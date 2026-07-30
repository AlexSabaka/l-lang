# 📚 l-lang Documentation Index

**l-lang has two backends. The C backend is the reference implementation (D86); the JavaScript
backend is a deprecated differential-testing oracle (D66).** Documentation written before 2026-07
describes a JavaScript-only project — where a document and the tree disagree, the tree wins, and
`spec/DECISIONS.md` is the tie-breaker between two parts of the tree.

---

## 🚀 Start here

*   **[Quick Start](quick-start.md)** — install, first program, on the reference backend.

## 📖 Learning the language

*   **[Language Syntax](language-syntax.md)** — the forms, each pinned to a corpus program.
*   **[Language Reference](language-reference.md)** — the intrinsic floor, the ambient names, and the importable stdlib.

## 🧭 The spec — normative

These are authoritative. When a guide and a spec disagree, the spec is right.

*   **[DECISIONS.md](spec/DECISIONS.md)** — every ruling, D1–D90, with the measurement behind it. **Start at its topic index**; the log itself is ordered by date, not by subject.
*   **[FLOOR.md](spec/FLOOR.md)** — the intrinsic floor: the runtime contract both backends implement, specified once so they cannot silently drift.
*   **[STDLIB.md](spec/STDLIB.md)** — where the library lives, what it exports, and the house rules it is written against.
*   **[GRAMMAR.ebnf](spec/GRAMMAR.ebnf)** — generated straight off the parser by `npm run grammar:ebnf`, so it cannot be wrong. (`npm run grammar:diagrams` builds a railroad viewer beside it.)
*   **[C-BACKEND-FINDINGS.md](spec/C-BACKEND-FINDINGS.md)** — the dated defect log for the reference backend, §9–§21, cited by number from `src/`.
*   **[IDENTITY.md](spec/IDENTITY.md)** — what l-lang is, what it deliberately is not, and where the design is currently incoherent. Start here if you want the shape of the thing.
*   **[PRIOR-ART.md](spec/PRIOR-ART.md)** — where the design was borrowed from, and from whom.

## 🏗️ Internals

*   **[Compiler Guide](language-compiler.md)** — the pipeline: frontend → analysis → transformation → types → HIR → the two backends.

## 🗺️ Status and history

*   **[Roadmap](roadmap.md)** — phases, what is built, and the **known gaps** (live, reproduced, and deliberately not yet fixed).
*   **[Changelog](changelog.md)** — narrative per release.
*   **[_archive/](_archive/README.md)** — documents that did their job, each bannered with the ruling that consumed it. Not maintained; do not read against the current tree.
*   **[inbox/](inbox/README.md)** — working documents still holding live work.

## 🤝 Contributing

*   **[Contributing](CONTRIBUTING.md)** — build, test, and the review checklist.
*   **[CLAUDE.md](../CLAUDE.md)** — the working contract: the full gate, the three ledgers and their opposite polarities, and why a golden is never blessed from compiler output.
*   **[src/test/README.md](../src/test/README.md)** — how the suite works.
*   **[rules/diagnostics/README.md](../src/compiler/rules/diagnostics/README.md)** — how to add a diagnostic.

---

## Where the truth lives

| question | answer |
|---|---|
| what was decided, and why | `spec/DECISIONS.md` |
| what is built right now | `src/test/{manifest,c-status,js-status}.ts` — read by the suite, so they cannot go stale |
| what the language accepts | `spec/GRAMMAR.ebnf` — generated from `Parser.ts` |
| what a diagnostic means | `src/compiler/rules/diagnostics/` — the message is the documentation |
| what is broken on purpose | `roadmap.md`, Known gaps |

# 🤝 Contributing to l-lang

Sloths and turtle followers are welcome.

---

## 📋 Before you start

Two things decide most questions, and knowing them saves re-litigating:

1. **C is the reference backend** (D86). JavaScript is a deprecated differential-testing oracle
   (D66). A change that is green on JS and untested on C is untested.
2. **Language decisions are D-numbered** in [`spec/DECISIONS.md`](spec/DECISIONS.md), with the
   measurement that produced them. If your change touches a ruling, read it first — and if you
   disagree with one, that is a conversation to have *before* the code, not a thing to work around.

The machine-facing companion to this document is [`CLAUDE.md`](../CLAUDE.md) at the repo root: the
same rules, stated for an agent, with the enforcing file named beside each one.

---

## 🚀 Getting started

### 1. Clone & set up

**`package.json` lives in `src/`, not at the repo root.**

```bash
git clone https://github.com/AlexSabaka/l-lang.git
cd l-lang/src

npm install
npm run build

npm test              # the corpus, on the JS oracle
npm run test:c        # the corpus, on the C reference
```

Compiling to C shells out to `cc`, so you need a C compiler on your PATH.

### 2. Understand the pipeline

[The compiler guide](language-compiler.md) walks it. The short version:

```
.lisp → PARSE → SYNTAX → SYMBOLS → DESUGAR → TYPES → HIR ─┬─► C   (reference)
                                                          └─► JS  (oracle)
```

The **HIR** is the neutral typed core: a decision *both* backends make belongs in it, so they cannot
diverge; a pass leaves core only if it is genuinely single-backend (D45, D48).

### 3. Learn the codebase

| you want | read |
|---|---|
| how to run things | [quick-start.md](quick-start.md) |
| what the language accepts | [spec/GRAMMAR.ebnf](spec/GRAMMAR.ebnf) — generated from the parser |
| why anything is the way it is | [spec/DECISIONS.md](spec/DECISIONS.md) — start at its topic index |
| the runtime contract | [spec/FLOOR.md](spec/FLOOR.md) |
| how the suite works | [src/test/README.md](../src/test/README.md) |
| how to add a diagnostic | [rules/diagnostics/README.md](../src/compiler/rules/diagnostics/README.md) |
| what's broken on purpose | [roadmap.md](roadmap.md), Known gaps |

---

## 📝 How to contribute

### Finding work

- [`roadmap.md`](roadmap.md)'s **Known gaps** is live and reproduced — each entry has evidence.
- `xfail` entries in `src/test/manifest.ts` each name what they are blocked on.
- `src/test/c-status.ts` lists the C backend's remaining refusals.

### The gate

**Green before every commit.** All of it, from `src/`:

```bash
npm test                      # JS backend — the oracle
npm run test:c                # C backend — the reference
npm run test:c:o2             # the same, at -O2
npm run test:codegen
npm run test:docs             # links, corpus paths, LLxxxx, npm scripts, grammar freshness
npm run test:ast-invariants
npm run test:type-errors
npm run test:diagnostics
npm run test:imports
npm run test:memory
npm run test:grammar-v2-smoke
npx tsc --noEmit
```

**CI is not the gate.** `.github/workflows/ci.yml` runs `npm ci`, `npm run build`, `npm test` — the
deprecated backend, and nothing else. Green CI proves very little.

**`test:c:o2` is not optional.** The C emitter marks locals `volatile` when they can be clobbered
across a `setjmp` landing (C11 7.13.2.1p3). At `-O0` those reads happen to work whether or not the
emission is correct, so only an optimized run can falsify it.

### Testing

- **Must pass**: the gate above.
- **Should add**: examples that attack the change.
- **Format**: example-based (`.lisp` + `.expect`).

> **`examples/` has two jobs — a feature showcase AND the end-to-end conformance
> suite.** Unlike `test:codegen` / `test:grammar-v2-smoke` / `test:diagnostics`
> (which assert on emitted text, tokens, or diagnostic codes), the runner
> (`npm test`) actually *compiles and runs* every `.lisp` and diffs stdout
> against its `.expect` golden. So the corpus is the language's behavioural
> regression net.
>
> After each feature or refactor, **add new example program(s) that try to break
> the change in several ways** — adversarial shapes and edge cases, not just a
> happy-path demo. A happy-path corpus is a *regression* guard, not a
> *correctness* guard: it demonstrates features, it doesn't attack them. (Two
> evaluation-order bugs once shipped green because nothing in the corpus
> exercised an impure operand before a compound one.)
>
> Golden only output you have reasoned is **correct** — never bless whatever
> falls out, or you freeze the bug into "expected". If an example can't be made
> green because it hits a real gap, classify it in `src/test/manifest.ts` as
> `xfail` (with a reason) or `negative` (with codes) — never leave a bare failing
> file; the runner hard-errors on any undeclared, goldenless `.lisp`. Examples
> are grouped by domain under decade-block numbers (`00-basics` … `20-algorithms`,
> `30-applications`, `40-math`, `80-adversarial`, `90-diagnostics`, `99-fixtures`).

---

## ✅ Standards

### A claim about the code is a claim about a measurement

This is the house style and it is not decoration. If you write *"this costs the corpus nothing"*,
run the sweep and paste the number. If you write *"the emitted C is identical"*, diff it. Predictions
here have been falsified by measurement often enough that an unmeasured claim in a commit message is
a defect in the commit.

### Ask "who calls it?"

The project's signature failure mode is code that exists, is correct, and is called by nobody — found
**nine** times, tabulated in [`roadmap.md`](roadmap.md). Of a claimed feature, do not ask *"is it
implemented?"*; `git grep` the identifier and count the call sites.

### TypeScript

Match the surrounding code. Comments explain *why*, not *what* — and in this repo a comment that
records a measurement or a rejected alternative is worth more than one that narrates the line below
it.

### Diagnostics

Every user-facing refusal gets an `LLxxxx` with a location. Never a bare `throw` — a compiler that
hands a user a Node stack trace is a bug regardless of what it was refusing. See the
[registry README](../src/compiler/rules/diagnostics/README.md); `npm run test:diagnostics` allocates
the next free code and requires a probe for it.

### Commits

- One logical change per commit.
- Stage explicit paths; never `git add -A` across the repo.
- The subject line is a one-line ruling in the same register as the log:
  `D85: integer division by zero PANICS; a literal zero is a compile error`.

---

## 💡 Design philosophy

When adding a feature, ask:

1. **Does it fit?** Lisp elegance with static typing; pragmatic, not over-engineered.
2. **Is it orthogonal?** It should compose with what exists rather than duplicate it.
3. **Is it testable?** If you cannot write a corpus program that would fail without it, be suspicious.
4. **Is it ruled?** A rule applied because it seemed consistent, rather than because it was decided,
   is how a language grows a surface nobody agreed to. Record an open question instead.
5. **Does it grow the surface, or the contract?** The recent history here is almost entirely
   contract — rules over syntax that already exists. That is usually the better answer.

---

## 🐛 Reporting bugs

A useful report has: a **minimal** program, what you expected and why, what each backend actually
printed, and the command you ran. A divergence between backends is especially valuable — that is
what the oracle is for.

The best bug reports arrive as a corpus file in `examples/80-adversarial/`.

---

## 🆘 Getting help

- **Why is it like this?** → [spec/DECISIONS.md](spec/DECISIONS.md), topic index first
- **What is broken?** → [roadmap.md](roadmap.md), Known gaps
- **How does the suite work?** → [src/test/README.md](../src/test/README.md)
- **Anything else** → open a GitHub issue

---

## 🙏 Thank you

The corpus is the reason any of this can be trusted. Every adversarial example you add makes the
next change safer.

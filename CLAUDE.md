# l-lang — the working contract

A statically typed Lisp with **two backends**. This file is what an agent needs before touching
anything; everything in it is checkable against the tree, and where it states a rule it names the
file that enforces it.

## The one fact that reorders everything else

**C is the reference backend (D86). The JavaScript backend is deprecated and retained as a
differential-testing oracle only (D66).**

The compiler says so itself — `Context.ts` emits a deprecation warning on every JS codegen, at
`LogLevel.Warning`, which is the default minimum, so it prints. A change that is green on JS and
untested on C is untested.

Most documentation older than 2026-07 predates this and reads as if JavaScript were the target. When
a doc and the tree disagree, the tree wins, and `docs/spec/DECISIONS.md` is the tie-breaker between
two parts of the tree.

## Where things are

There is **no `package.json` at the repository root**. Every `npm run` is from `src/`.

```
src/            the compiler (TypeScript). package.json lives HERE.
lib/std/        the standard library, written in l-lang — 17 packages, 38 modules
examples/       326 .lisp programs. This is the end-to-end suite, not a demo folder.
docs/spec/      DECISIONS.md is the spec. Rulings D1–D90.
```

`cd src` before any npm command. Every path in this file is relative to the repo root.

## The gate

Green before **every** commit, all of it, from `src/`:

```
npm test                     # JS backend — the oracle
npm run test:c               # C backend — the reference
npm run test:c:o2            # the same, at -O2
npm run test:codegen
npm run test:ast-invariants
npm run test:type-errors
npm run test:diagnostics
npm run test:imports
npm run test:memory
npm run test:grammar-v2-smoke
npx tsc --noEmit
../l-lang-games/verify.sh    # from the repo root — the games parity suite, both backends
```

Baseline to hold, measured at `b948330`: **JS 276 passing / 0 failing / 5 oracle-divergent / 8 xfail.
C 269 passing / 0 failing / 5 refused / 1 not-yet.** Both over the same 326-file total (13 library,
1 fixture). Any movement is a finding — report the number, do not adjust it silently.

**CI is not the gate.** `.github/workflows/ci.yml` runs `npm ci`, `npm run build`, `npm test` — the
deprecated backend, and nothing else. Green CI means almost nothing; run the list above.

**`test:c:o2` is not redundant.** The C emitter marks locals `volatile` when they can be clobbered
across a `setjmp` landing (C11 7.13.2.1p3, `src/compiler/codegen/c/volatiles.ts`). At `-O0` those
reads happen to work whether or not the emission is correct, so **only an optimized run can falsify
it**. That fence
is how the original clobber surfaced — `18-error-handling/11` printing `0/0` for `5/5` at any `-O`
above zero, silently, for the whole life of the corpus before it.

## The three ledgers, and their opposite polarities

| file | what it lists | red when |
|---|---|---|
| `src/test/manifest.ts` | every `.lisp` that is not an ordinary golden test | an undeclared, goldenless file exists at all — **hard error**, never a skip |
| `src/test/c-status.ts` | files the C backend **must** pass | listed and failing → regression · **unlisted and PASSING → RATCHET** |
| `src/test/js-status.ts` | files the JS backend is **known** to fail | listed and failing is fine · **listed and PASSING → RATCHET** |

The C list is an allowlist that **grows** as the backend advances; the JS list **shrinks** as gaps
close. So a newly-passing C file turns the build red until it is added, and a newly-passing JS file
turns it red until it is removed. A ratchet without teeth decays.

Both backends are graded against the **same** `.expect`. That is the entire parity instrument — one
golden, two implementations, and a divergence has nowhere to hide. Giving a file two goldens would
make every entry green and measure nothing. A file where C is right and the frozen JS backend is
measurably wrong gets `oracleDivergent` on its manifest entry, whose string states the JS defect, so
the skip is a recorded measurement rather than a shrug.

## Never bless a golden

A `.expect` is **authored from intent**, hand-derived, before it is compared to anything the compiler
printed. Capturing output freezes the bug into "expected" — the exact mistake `manifest.ts` exists to
stop repeating, and it has been made here before.

If a program cannot be made green because it hits a real gap, classify it: `xfail` with a `reason`
citing the D-number it is blocked on, or `negative` with the `codes` it must report. Never leave a
bare failing file.

## Land adversarial examples with every change

`examples/` has two jobs — a feature showcase **and** the conformance suite. A happy-path corpus is a
regression guard, not a correctness guard: it demonstrates features, it does not attack them. Two
evaluation-order bugs once shipped green because nothing exercised an impure operand before a
compound one.

So with each feature or fix, add programs that try to **break** it several ways. They go in
`examples/80-adversarial/`. Examples are grouped by decade block: `00-basics` … `20-algorithms`,
`30-applications`, `40-math`, `80-adversarial`, `90-diagnostics`, `99-fixtures`.

## Rulings

Language decisions are **D-numbered** and live in `docs/spec/DECISIONS.md`, with the measurement that
produced them. Where the grammar, the docs or the corpus disagree with a ruling, the ruling wins and
they get brought into line.

Do not invent a rule to close a gap. A rule that is applied because it seemed consistent, rather than
because it was ruled, is how a language grows a surface nobody agreed to — record it as an open
question instead. Commit subjects are one-line rulings in the same register:
`D85: integer division by zero PANICS; a literal zero is a compile error`.

## Diagnostics

Imperative diagnostics live in `src/compiler/rules/diagnostics/` — one category file per emitting
domain, codes banded (`00xx` syntax · `0099` comptime · `01xx` codegen · `02xx` type · `03xx`
module). `npm run test:diagnostics` prints the allocator (`LL02xx: 29 taken, next free LL0209`) and
every new code needs a probe there. The declarative rules in
`src/compiler/rules/NodeValidationRules.ts` carry the rest. See that directory's own `README.md` —
it is current, and it is the pattern the rest of the docs are being rewritten toward: small, local,
pinned to something executable.

## Commits

- One logical change per commit.
- Stage explicit paths. **Never `git add -A`.**
- Trailers, verbatim — the name is the persona, never a model name; a PreToolUse hook enforces it:

```
Co-Authored-By: Claude Cheetah 5 (1M context) <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_01EXH6MysSRBQw2CjcC2o1PB
```

## The failure mode this project has, nine times

Code that exists, is correct, and is **called by nobody**. The desugarer, two runtime matchers, the
type channel, `InlineImportsAstVisitor`, `visitTypeName`, `LL0004`, `:extern`, `isRuntimeFunction`,
`FunctionNode.generics` — every one had a green tree and a ticked box. The table is in
`docs/roadmap.md`.

Of a claimed feature, do not ask *"is it implemented?"* Ask **"who calls it?"** — then `git grep` the
identifier and count the call sites.

## A claim about the code is a claim about a measurement

If you write "this costs the corpus nothing", run the sweep and paste the number. If you write "the
emitted C is identical", diff it. Predictions in this repo have been falsified by measurement often
enough that an unmeasured claim in a commit message is a defect in the commit.

## Pointers

| you want | read |
|---|---|
| what was decided and why | `docs/spec/DECISIONS.md` |
| what is built, what is left, what is broken | `docs/roadmap.md` |
| the runtime contract both backends must not diverge on | `docs/spec/FLOOR.md` |
| how a diagnostic is added | `src/compiler/rules/diagnostics/README.md` |
| the grammar, straight off the parser | `npm run grammar:ebnf` |

Rows are added to this table as the documentation sweep lands each one.

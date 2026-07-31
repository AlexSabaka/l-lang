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
lib/std/        the standard library, written in l-lang — 18 packages, 40 modules
examples/       372 .lisp programs. This is the end-to-end suite, not a demo folder.
docs/spec/      DECISIONS.md is the spec. Rulings D1–D116.
```

`cd src` before any npm command. Every path in this file is relative to the repo root.

## The gate

Green before **every** commit, all of it, from `src/`:

```
npm run test:c               # C backend — the reference
npm run test:c:o2            # the same, at -O2
npm run test:codegen
npm run test:docs            # the documentation gate -- links, corpus paths, LLxxxx, npm scripts, grammar freshness
npm run test:ast-invariants
npm run test:type-errors
npm run test:diagnostics
npm run test:imports
npm run test:memory
npm run test:grammar-v2-smoke
npx tsc --noEmit
../l-lang-games/verify.sh    # from the repo root — the games parity suite, both backends
```

**`npm test` is NOT on that list, as of D103.** The JS lane is an *instrument*, not a gate: it is run by
hand, in a deliberate differential session, and its result never blocks a commit. That is where its
value always came from — `runner.ts:29` grades one backend per invocation against the golden and has
never compared the two, so every JS↔C comparison in this project's history was a hand-run. What stopped
is the per-commit ceremony, not the capability. See D103 for the measurement, including why the ledger
made the oracle look useless when it had in fact surfaced ~17–20 C defects.

Baseline to hold, measured at the coercion-recursion fix (2026-07-31): **C 317 passing / 0 failing /
2 refused / 0 not-yet**, over a 372-file total (13 library, 1 fixture, 31 negative). Any movement is
a finding — report the number, do not adjust it silently.

The JS lane's figures are a **timestamped observation, not a figure that must hold** — re-measure when
you pick the instrument up. Last measured at `b102475` (2026-07-30): JS 303 passing / 0 failing / 9
oracle-divergent / 8 xfail, over the same 357.

**Both remaining C refusals in the CORPUS are `:async`, refused by RULING (D60), not by gap** — so a
new refusal *among the 372* is a regression, not a backlog item, and should be read that way.

**That is a claim about the corpus, and it does not generalise.** This line used to say there was no
longer any construct the reference backend declined because nobody built it. D115 falsified it in one
afternoon by writing programs the corpus never contained — six constructs, every one green on JS,
three now fixed and three still open:

| the construct | how it fails | recorded |
|---|---|---|
| an INDEX store in a `for` `:step` | uncaught `Error`, Node stack trace — **and no `:gen` involved** | `docs/roadmap.md` |
| a nested `fn` in a generator | invalid C: undeclared `__ll_gen_state` | `docs/roadmap.md` |
| `restart-case` / `handle` in a generator | `ELL0106` refusal, honest | `promoteFrame.ts:180` |
| `try` in a generator | **fixed by D115** | `80-adversarial/try_inside_generator.lisp` |
| `for :init` + `yield` in a generator | **fixed by D116** | `80-adversarial/for_loop_inside_generator.lisp` |
| `match` in a generator | **fixed** — P2 now visits P1's boxes | `80-adversarial/forms_inside_generator.lisp` |

The first row is the one to read twice: it needs no generator, no `try` and no import, and it crashed
the compiler rather than refusing. **A crash is worse than a refusal**, and this one sat under a green
gate because no corpus file happened to write an indexed `:step`. Rows two and six are worse still —
they emit C that does not compile, which is a defect the corpus cannot even express as a failing test.

The corpus is a floor, not a census: what it does not contain, it cannot refuse. Ask *"who calls
it?"* of a claim of coverage exactly as of a claim of implementation.

*Adjusting this line is not the same as adjusting a number silently.* It moves only when every step
between the old figure and the new one was reported in a commit message, and each of the 28 files
added since `b948330` is named in `c-status.ts` with what it measures.

**CI is not the gate.** `.github/workflows/ci.yml` runs `npm ci`, `npm run build`, `npm test` — the
deprecated backend, and nothing else. Since D103 that is not merely thin, it is the one lane the gate
no longer contains: CI grades an instrument. Green CI means almost nothing; run the list above.

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
| `src/test/js-status.ts` | files the JS backend is **known** to fail | *instrument-side since D103* — red only during a hand-run |

The C list is an allowlist that **grows** as the backend advances; the JS list **shrinks** as gaps
close. So a newly-passing C file turns the build red until it is added. A ratchet without teeth decays.

**D103 moved the JS row out of the commit path.** `js-status.ts` and `manifest.ts`'s 9 `oracleDivergent`
entries are both **retained and not collapsed** — those strings are the surviving record of what a
two-implementation differential bought (four are named rulings: D78, D80, D84, D85), and dropping them
would make a hand-run report 9 known failures as noise. What ended is the *obligation to add new ones*:
a C-correct feature that JS gets wrong is now simply left wrong.

When both backends are run they are graded against the **same** `.expect` — one golden, two
implementations, and a divergence has nowhere to hide. Giving a file two goldens would make every
entry green and measure nothing. A file where C is right and the frozen JS backend is measurably
wrong gets `oracleDivergent` on its manifest entry, whose string states the JS defect, so the skip is
a recorded measurement rather than a shrug.

**Read "when both are run" literally.** The harness grades one backend per invocation and has never
compared the two (`runner.ts:29`); the parity instrument is a *hand-run*, and since D103 it is not
part of the commit path at all.

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
module). `npm run test:diagnostics` prints the allocator (`LL02xx: 49 taken`, and the next free) and
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

## The second failure mode: one sibling learns the rule, the other does not

Three times on 2026-07-30 alone, in the C backend, a rule was applied at one site and not at the site
beside it:

| the rule | who knew it | who did not |
|---|---|---|
| clamp `__argc` before reading `__argv[i]` | the rest-parameter prologue | three fixed-parameter reads *in the same loop* |
| a callee packs its own `[...rest]` | the lifted-closure prologue | the function adapter |
| `(f)` is a call iff `f` names a function | `classifyCall`, `resolveFreeCall` | `resolveCall`, which asked "is it a local?" |

Each was a real defect (a SIGSEGV, a `TypeError`, and a closure returned instead of called), and each
had a **correct comment ten lines away explaining the rule it violated**. A missing case is the same
shape: `resolveAstExpr` had `vector` and no `map`, which refused two unrelated features.

So when you fix one arm of a switch or one branch of a dispatch, **read its siblings before you
leave**, and say in the commit whether they agree. `git grep` the runtime function, not the concept.

## A claim about the code is a claim about a measurement

If you write "this costs the corpus nothing", run the sweep and paste the number. If you write "the
emitted C is identical", diff it. Predictions in this repo have been falsified by measurement often
enough that an unmeasured claim in a commit message is a defect in the commit.

## Pointers

| you want | read |
|---|---|
| what l-lang is, and is not | `docs/spec/IDENTITY.md` |
| what was decided and why | `docs/spec/DECISIONS.md` |
| what is built, what is left, what is broken | `docs/roadmap.md` |
| the runtime contract both backends must not diverge on | `docs/spec/FLOOR.md` |
| how a diagnostic is added | `src/compiler/rules/diagnostics/README.md` |
| the grammar, straight off the parser | `npm run grammar:ebnf` |

Rows are added to this table as the documentation sweep lands each one.

# The test suite

`examples/` has two jobs: a feature showcase **and** the end-to-end conformance suite. The runner
compiles and *runs* every `.lisp` on both backends and diffs stdout against a single `.expect`
golden. That is the language's behavioural regression net.

---

## The one rule

**A golden is authored from intent. It is never captured from compiler output.**

If you write the output the compiler currently produces into a `.expect`, you have frozen whatever
it does today — bug and all — into "expected", and the suite will defend the bug from then on. That
is not hypothetical: it is the exact mistake `manifest.ts` exists to stop repeating, and **this file
used to tell you to make it** (`node examples/your-test.js > examples/your-test.expect`).

Work out what the program *should* print, by reading it. Then compare.

If a program can't be made green because it hits a real gap, **classify it** — never leave a bare
failing file:

| status | when | requires |
|---|---|---|
| `test` | ordinary — the default for any file with a `.expect` | a golden |
| `xfail` | a real feature example blocked on something unbuilt | a `reason`, citing the D-number where there is one |
| `negative` | the file is *supposed* to fail | `codes`: every diagnostic it must report |
| `library` | imported by another example, never run standalone | — |
| `fixture` | not verifiable this way (needs a browser, say) | — |

The runner **hard-errors** on an undeclared, goldenless `.lisp`. There is no silent skip.

---

## Running it

All from `src/`.

```bash
npm test                 # the JS backend — the oracle
npm run test:c           # the C backend — the reference
npm run test:c:o2        # the same, at -O2
npm test -- --verbose    # show diffs
npm run test:c -- --jobs=4
```

**`test:c:o2` is not redundant.** The C emitter marks locals `volatile` when they can be clobbered
across a `setjmp` landing (C11 7.13.2.1p3). At `-O0` those reads happen to work whether or not the
emission is right, so only an optimized run can falsify it — and it caught a live bug in plain
`try`/`catch`, not just in D47's restarts.

The other suites, each with its own entry point in `package.json`:

| command | what it asserts |
|---|---|
| `test:codegen` | emitted text, form by form |
| `test:type-errors` | the corpus reports zero diagnostics |
| `test:diagnostics` | every `LLxxxx` still fires, against a snapshot |
| `test:imports` | module resolution and visibility |
| `test:memory` | no leaks in the C runtime |
| `test:ast-invariants` | the tree holds its shape between passes |
| `test:grammar-v2-smoke` | the parser accepts what it should |

---

## The three ledgers

Every corpus file is accounted for by one of these, and they have **opposite polarities** on purpose.

### `manifest.ts` — what a file *is*

Backend-independent. Anything that is not an ordinary golden test is declared here with a reason.
`oracleDivergent` on a `test` entry means *graded on C, skipped on JS* — for a file where C is right
and the frozen JS backend is measurably wrong (D86). The string records the JS defect, so the skip
is a measurement rather than a shrug.

### `c-status.ts` — what C **must** pass

An allowlist that **grows** as the backend advances.

| | |
|---|---|
| listed and failing | 🔴 regression |
| unlisted and failing | `not-yet` — expected; the backend is phased |
| **unlisted and PASSING** | 🔴 **RATCHET** — add it here |
| refused (`LL0105`–`LL0107`) | informational; the backend said so on purpose |

### `js-status.ts` — what JS is **known** to fail

The mirror, and it **shrinks**.

| | |
|---|---|
| listed and failing | `not-yet` — expected |
| **listed and PASSING** | 🔴 **RATCHET** — remove it here |
| unlisted and failing | 🔴 ordinary regression |

A ratchet without teeth decays, which is why both directions are red.

---

## One golden, two backends

Both backends are graded against the **same** `.expect`. That is the entire parity instrument: one
golden, two implementations, and a divergence has nowhere to hide.

Giving a file two goldens would make every entry green and measure nothing — which is why a known,
costed, deliberately-declined divergence is *listed in `js-status.ts`* and stays red-by-declaration
rather than being papered over with a second expectation.

---

## Adding a test

1. Write `examples/<decade-block>/NN_name.lisp`. The blocks are `00-basics` … `20-algorithms`,
   `30-applications`, `40-math`, `80-adversarial`, `90-diagnostics`, `99-fixtures`.
2. **Derive** the expected output by reading the program. Write it to `NN_name.expect`.
3. Run it on both backends. If they disagree, you have found something — that is the instrument
   working.
4. If it passes on C, add it to `c-status.ts`, or the next run goes red demanding it.

**Adversarial examples land with every change.** A happy-path corpus is a *regression* guard, not a
*correctness* guard: it demonstrates features, it does not attack them. Two evaluation-order bugs
once shipped green because nothing exercised an impure operand before a compound one. New attacks go
in `examples/80-adversarial/`, which is 90 programs and the reason most of the documentation can be
trusted.

---

## Troubleshooting

**"Undeclared example with no golden"** — the hard error. Add a `.expect`, or classify the file in
`manifest.ts`.

**A C file says RATCHET** — it started passing. Add it to `C_PASSING`.

**A JS file says RATCHET** — a gap closed. Remove it from `JS_NOT_YET`.

**Output differs** — run with `--verbose` for the diff. Then work out which side is wrong; do **not**
regenerate the golden to match. If the intended behaviour genuinely changed, re-derive the golden
from the new intent and say so in the commit.

**It passes at `-O0` and fails at `-O2`** — that is the `setjmp` clobber fence doing its job. See
`src/compiler/codegen/c/volatiles.ts`.

---

Counts are deliberately not repeated here. `manifest.ts`, `c-status.ts` and `js-status.ts` are read
by the runner, so they cannot go stale; a number in this file can, and did.

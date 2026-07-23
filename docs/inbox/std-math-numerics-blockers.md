# std/math — what landed, and the two numerics modules still blocked (2026-07-23)

Picking up the math package after the dynamic workflow died on a spend limit. The foundation and
three of the five numerics modules are **done, verified on both backends, committed**. Two are
blocked on real language/backend limitations — not on missing work, on decisions.

## Landed (verified byte-identical JS == C, goldens hand-derived)

| module | commit | notes |
|--------|--------|-------|
| constants, elementary, complex, rational, vector, symbolic/expr | `94b3856` | the D57 foundation |
| integrate | `ab6d297` | quadrature + root-finding over a `RealFn` object |
| stats | `acfe42d` | descriptive + OLS; mergesort `cond`→`if` (JS gap, ledger §10) |
| special | `bf64395` | gamma/beta/erf + past-int64 factorial |

D57 (five operators, glyph rules) is written into `DECISIONS.md`. Every golden is derived from
mathematics and checked by hand, never captured from a run.

## BLOCKED 1 — `random` (SplitMix64): int64 wraparound does not survive JS

The generator is SplitMix64, which is **defined over mod-2^64 arithmetic** — the Weyl step
`state += golden-gamma` and the two finalizer multiplies all deliberately overflow int64 and rely on
the overflow wrapping. On **C** that is free (`int64_t`, `-fwrapv`). On **JS** it is fatal: D51 makes
`Int` an unbounded **BigInt**, so nothing wraps — the multiplies grow to 128 bits, the 32-bit
`bits-hi32/lo32` decomposition then reads the wrong bits, and `next-int` collapses to a constant
(`0xFFFFF00000000000` for every draw, measured). The module's header *claims* "byte-identical JS == C
== reference", but that measurement did not survive its agent dying — the current code is C-only.

**Why it is not a quick fix.** Portability needs every 64-bit op reduced mod 2^64 and re-signed, via
a `wrap64`/`mul64` that is itself built only from safe-range (< 2^53) operations — i.e. a 16-bit-limb
modular multiply, because even a 32×32 product (< 2^64) overflows signed int64 on C. And the signed
threshold `2^63` and modulus `2^64` are **not representable as positive `Int` literals** at all (they
exceed int64 max), so the reduction cannot even be spelled the obvious way. This is really a
**language-level question**: does l-lang want a native wrapping-u64 / `mul-wrap` primitive (the honest
fix, reusable by hashing, checksums, any bit-twiddling stdlib), or should `random` be **redesigned**
onto a generator that stays inside the shared safe-integer range (e.g. PCG or a 32-bit engine whose
products never exceed 2^53)? That is a call to make, not to guess — a redesign silently swaps
SplitMix64's quality for a weaker generator.

Reference stream (independently computed, for whoever picks this up): SplitMix64(0) =
`-2152535657050944081, 7960286522194355700, 487617019471545679, -537132696929009172`; `next-real`
for seed 42 first draw = `0.7415648787718233`; a fully-drafted, reference-checked example is held at
`scratchpad/math-hold/examples/08_random.lisp` and will pass the moment the arithmetic is portable.

## BLOCKED 2 — `fft`: a JS index bug AND a C computed-callee gap

Two independent defects, both from the died agent:

1. **JS runtime:** `RangeError: IndexOutOfRange: 2.5` inside the transform. An array is indexed by a
   non-integer somewhere in `fft-core`/`fft-revbits` — a `(/ a b)` that should be integer (D49d) but
   is landing Real, or a Real leaking into an index. Not yet pinned to a line.
2. **C backend:** `ELL0106 Cannot generate C for 'computed-callee'` — the module calls a function
   through a **computed expression** that `resolveCall` has no CIR lowering for. Even with the JS bug
   fixed, C cannot compile it until either the construct is rewritten to a direct call or the C
   backend learns computed callees.

Held at `scratchpad/math-hold/modules/fft.lisp`. Derivable goldens are ready (constant `[1,1,1,1]` →
`[4,0,0,0]`, delta → flat, round-trip `ifft(fft(x)) = x`); the module needs debugging first.

## Also outstanding (synthesis, not a blocker)

The pre-workflow `math.lisp` still exists as the package **entry** and still defines `Vector3` with
`(fn :operator ·)` — the U+00B7 head operator **D57 bans**. Its consumers (`complex_math_test`,
`08_vector_toolkit`, `geometry/measure`) import `std/math` through it. Retiring it (fold into a thin
re-export aggregator, migrate the three consumers to `complex`/`vector`) is the last integration step,
tracked but not started. `STDLIB.md` still documents the old single-`math.lisp` layout.

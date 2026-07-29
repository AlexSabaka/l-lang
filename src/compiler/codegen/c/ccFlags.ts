/**
 * THE C COMPILER FLAGS, IN ONE PLACE — because they had drifted, and the drift was invisible.
 *
 * Every test harness compiled with `-std=c11 -fwrapv`; the user-facing `llang run` compiled with
 * neither. So the whole gate — `npm test`, `test:c`, `test:c:o2`, `test:imports`, `test:memory` —
 * was grading a program built with different semantics than the one a user actually gets. Nothing
 * could have noticed: both compile, both run, and they only diverge where the difference matters.
 *
 * WHY EACH FLAG IS A CORRECTNESS FLAG, not a preference:
 *
 *   -fwrapv   Signed overflow is UNDEFINED in C, and l-lang's Int is `int64_t`. D88's numeric tower
 *             specifies wrapping (the JS shim masks with `asIntN(64)` to match), so the native
 *             backend must wrap too. Without this the optimiser is licensed to assume overflow
 *             cannot happen and delete the code that handles it — and `test:c:o2` is exactly where
 *             that would bite, which is the run this repo already keeps for the setjmp clobber.
 *
 *   -std=c11  The runtime and the emitter are written to C11 and say so: `volatiles.ts` cites
 *             "C11 7.13.2.1p3" for the setjmp rule, and `ll_obj` uses a flexible array member.
 *             Leaving the standard to the host compiler's default makes the emitted program's
 *             meaning depend on which `cc` is installed.
 *
 *   -lm       libm is a separate library on Linux and folded into libSystem on macOS. The emitted C
 *             calls `sqrt`, `pow`, `sin`, `cos`, `log`, `exp`, `fmod`, `floor` and `ceil`, so
 *             omitting it links fine on a Mac and fails on Linux — a portability bug that a
 *             macOS-only sweep cannot see. Measured: `std/math` emits all nine.
 *
 * `-w` and `-O…` are NOT here. They are per-caller choices: `run` silences warnings from generated
 * code the user did not write, and `test:c:o2` opts into optimisation deliberately.
 *
 * `../l-lang-games/verify.sh` keeps its own `CC_FLAGS=(-std=c11 -fwrapv)` because it is a shell
 * script in another repository and cannot import this. It must be kept in step by hand; it is the
 * one copy this module cannot own.
 */

/** Flags that decide what the emitted program MEANS. Every caller passes these. */
export const CC_SEMANTIC_FLAGS: readonly string[] = ["-std=c11", "-fwrapv"];

/** Libraries the emitted C needs. Placed after the output, as linkers expect. */
export const CC_LIBS: readonly string[] = ["-lm"];

/** The whole command line for a plain build: `cc <flags> <src> -o <out> <libs>`. */
export function ccArgs(cPath: string, binPath: string, extra: readonly string[] = []): string[] {
  return [...CC_SEMANTIC_FLAGS, ...extra, cPath, "-o", binPath, ...CC_LIBS];
}

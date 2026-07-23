;; std/math/constants -- the mathematical and IEEE-754 constants a numeric tower stands on.
;;
;; No import. This is the FOUNDATION file of std/math (depends on nothing) and it is nothing but
;; named `let`s, so it is also the one file whose correctness is decidable by reading it against a
;; reference table rather than by running it.
;;
;; -----------------------------------------------------------------------------------------------
;; EVERY VALUE IS A LITERAL, NEVER A COMPUTATION -- and that is the whole design decision.
;;
;; The tempting spelling is `(let TAU (* 2.0 PI))`, `(let SQRT1_2 (/ 1.0 SQRT2))`, `(let LOG10E
;; (/ 1.0 LN10))`. It is wrong twice.
;;
;;   * It is not byte-safe. `+ - * /` are IEEE operations and DO agree across the two backends, but
;;     the moment a constant is defined by a libm call (`Math.sqrt`, `Math.log`) the backends may
;;     part in the last ULP -- the divergence the whole tower exists to keep out. A decimal literal
;;     has no libm in it: MEASURED, every literal below parses and prints IDENTICALLY on node and on
;;     clang (that measurement is what `examples/40-math/00_constants` pins).
;;
;;   * Division is not even correctly rounded to the value it names. MEASURED here this session:
;;         1/SQRT2  computes to 0.7071067811865475  -- the correctly-rounded 1/sqrt(2) is ...476
;;         1/LN10   computes to 0.43429448190325176 -- the correctly-rounded log10(e)  is ...518-tail
;;     i.e. `(/ 1.0 SQRT2)` is one ULP LOW of the true reciprocal, because it rounds the quotient of
;;     two already-rounded operands. The literals below are each the nearest double to the true
;;     MATHEMATICAL constant (verified against a 50-digit reference, neighbour-checked both ways),
;;     which is the value you actually want and the value C's `M_SQRT1_2` / node's `Math.SQRT1_2`
;;     also hold. So SQRT1_2 and LOG10E are LITERALS on purpose, not `1/SQRT2` and `1/LN10`.
;;
;; Where a relation happens to be exact in binary (TAU = 2*PI is just an exponent bump; phi*phi -
;; phi = 1 exactly for the stored phi) the example asserts it as a cross-check -- but the SOURCE OF
;; TRUTH is always the literal, never the arithmetic.
;;
;; Sourced from the standard references: pi/e/sqrt2/ln2/ln10 and their reciprocals are the C99
;; <math.h> M_* values (== node's Math.* to the bit); gamma is A001620; phi is A001622. Each is
;; given to the 17 significant digits that round-trip a double.
(
    ;; -- circle, exponential, roots, logarithms ----------------------------------------------------

    ;; pi. A001619 / M_PI. The nearest double sits 1.2e-16 ABOVE true pi -- unavoidable, it is the
    ;; closest representable value and every backend's `Math.PI` is this same double.
    (let PI 3.141592653589793)

    ;; tau = 2*pi, the turn. Exact doubling of PI in binary (nothing rounds), so it equals `(* 2.0
    ;; PI)` to the bit -- but kept as its own literal so a reader is not made to trust that.
    (let TAU 6.283185307179586)

    ;; Euler's number e. A001113 / M_E.
    (let E 2.718281828459045)

    ;; The golden ratio phi = (1+sqrt5)/2. A001622. Stored phi satisfies phi*phi = phi + 1 exactly
    ;; (MEASURED), which is the identity the example uses to prove the digits.
    (let PHI 1.618033988749895)

    ;; sqrt(2) and its reciprocal 1/sqrt(2) = sqrt(2)/2. M_SQRT2 / M_SQRT1_2.
    ;; SQRT1_2 is a LITERAL, not `(/ 1.0 SQRT2)`: the division lands one ULP low (see header).
    ;; The two are still related exactly the other direction -- 2*(1/sqrt2) = sqrt2 to the bit --
    ;; which the example asserts.
    (let SQRT2 1.4142135623730951)
    (let SQRT1_2 0.7071067811865476)

    ;; Natural logs of 2 and 10. M_LN2 / M_LN10.
    (let LN2 0.6931471805599453)
    (let LN10 2.302585092994046)

    ;; The reciprocal logs: log2(e) = 1/ln2 and log10(e) = 1/ln10. M_LOG2E / M_LOG10E.
    ;; MEASURED: LOG2E happens to equal `(/ 1.0 LN2)` exactly (the quotient rounds to the right
    ;; double), but LOG10E does NOT equal `(/ 1.0 LN10)` -- it is one ULP off. Both are given as
    ;; literals so the pair is sourced the same way and neither depends on a lucky rounding.
    (let LOG2E 1.4426950408889634)
    (let LOG10E 0.4342944819032518)

    ;; Euler-Mascheroni gamma = lim (H_n - ln n). A001620. No closed form and no libm entry -- it
    ;; MUST be a literal; there is nothing to compute it from at load time.
    (let EULER_GAMMA 0.5772156649015329)

    ;; -- IEEE-754 double boundaries ----------------------------------------------------------------
    ;;
    ;; l-lang CAN express the full boundary set on both backends -- CHECKED this session, all six
    ;; below print and compare identically on node and clang. The three special values are written
    ;; as IEEE divisions rather than literals: `1e400` would be an out-of-range literal (a clang
    ;; warning, and nothing forces the JS lexer to fold it the same way), whereas 1.0/0.0, -1.0/0.0
    ;; and 0.0/0.0 are DEFINED by the standard as +inf, -inf, NaN and were MEASURED to produce
    ;; exactly those on both. These are Real divisions on purpose: Int/0 is a fatal trap, not inf.

    ;; Machine epsilon for a double = 2^-52, the gap from 1.0 to the next representable value. Its
    ;; defining property (MEASURED both backends): 1+EPSILON != 1 but 1+EPSILON/2 == 1.
    (let EPSILON 2.220446049250313e-16)

    ;; Largest finite Real = largest positive normal = (2 - 2^-52)*2^1023. DBL_MAX. Doubling it
    ;; overflows to +inf (MEASURED), which is how the example proves it is the top of the finite range.
    (let MAX_VALUE 1.7976931348623157e308)

    ;; Smallest positive NORMAL Real = 2^-1022. DBL_MIN. This is NOT the smallest positive double --
    ;; subnormals go down to 2^-1074 (~5e-324) -- but it is the smallest with full 53-bit precision,
    ;; which is the boundary a numerical routine actually cares about. Deliberately not exported as a
    ;; "MIN_VALUE" so it can never be confused with the subnormal floor.
    (let MIN_NORMAL 2.2250738585072014e-308)

    ;; Positive and negative infinity, and the quiet NaN. NAN is the ONLY value with NAN != NAN
    ;; (MEASURED: (== NAN NAN) is false on both), which is the only portable way to test for it --
    ;; there is no `is-nan` here (that belongs to core.lisp, which may import this module).
    (let INF (/ 1.0 0.0))
    (let NEG_INF (/ -1.0 0.0))
    (let NAN (/ 0.0 0.0))

    (export
        PI TAU E PHI
        SQRT2 SQRT1_2
        LN2 LN10 LOG2E LOG10E
        EULER_GAMMA
        EPSILON MAX_VALUE MIN_NORMAL
        INF NEG_INF NAN)
)

;; std/math/constants -- the values the tower stands on, and the identities that prove their digits.
;;
;; The golden here is DERIVED, not captured. Every printed number is the nearest double to a known
;; mathematical constant (checked against a 50-digit reference), and every boolean is a relation that
;; is provable on paper -- tau = 2*pi, phi^2 = phi+1, the machine-epsilon gap at 1.0, the overflow of
;; DBL_MAX to +inf. Because these are LITERALS run through pure IEEE `+ - * /` and never through a
;; libm call, the two backends agree to the bit, so the golden pins EXACT values rather than bounds.

(import "std/math/constants")

;; A local absolute value. The example imports ONLY constants (std/math's foundation depends on
;; nothing and re-exports nothing), so `abs` from std/math is out of reach, and Math.abs is skipped
;; deliberately to keep the demo on l-lang arithmetic end to end. One line does it.
(fn absr [x <- Real] -> Real (if (< x 0.0) (return (- x)) (return x)))

(
    (console.log "-- mathematical constants --")
    (console.log "pi          =" PI)
    (console.log "tau         =" TAU)
    (console.log "e           =" E)
    (console.log "phi         =" PHI)
    (console.log "sqrt2       =" SQRT2)
    (console.log "1/sqrt2     =" SQRT1_2)
    (console.log "ln2         =" LN2)
    (console.log "ln10        =" LN10)
    (console.log "log2(e)     =" LOG2E)
    (console.log "log10(e)    =" LOG10E)
    (console.log "gamma       =" EULER_GAMMA)

    ;; Identities exact in binary -- these hold to the bit and pin the stored digits.
    (console.log "-- exact identities --")
    (console.log "tau = 2*pi          :" (== TAU (* 2.0 PI)))
    (console.log "sqrt2 = 2*(1/sqrt2) :" (== SQRT2 (* 2.0 SQRT1_2)))
    (console.log "phi^2 = phi+1       :" (== (* PHI PHI) (+ PHI 1.0)))

    ;; The reciprocal-log pairs multiply to 1. MEASURED both products are exactly 1.0 (0 ULP), but
    ;; the assertion is a 2-ULP bound because that is the honest promise for a reciprocal in general.
    (console.log "-- reciprocal logs (within 2 ULP) --")
    (console.log "log2(e)*ln2   ~ 1   :" (< (absr (- (* LOG2E LN2) 1.0)) (* 2.0 EPSILON)))
    (console.log "log10(e)*ln10 ~ 1   :" (< (absr (- (* LOG10E LN10) 1.0)) (* 2.0 EPSILON)))

    (console.log "-- IEEE-754 boundaries --")
    (console.log "epsilon     =" EPSILON)
    (console.log "max_value   =" MAX_VALUE)
    (console.log "min_normal  =" MIN_NORMAL)
    (console.log "+inf        =" INF)
    (console.log "-inf        =" NEG_INF)
    (console.log "nan         =" NAN)

    ;; Each boundary proven by its defining property rather than asserted.
    (console.log "-- boundary properties --")
    ;; Machine epsilon is the gap at 1.0: adding it moves off 1.0, adding half of it rounds back.
    (console.log "1+eps == 1          :" (== (+ 1.0 EPSILON) 1.0))
    (console.log "1+eps/2 == 1        :" (== (+ 1.0 (/ EPSILON 2.0)) 1.0))
    ;; DBL_MAX is the top of the finite range: doubling overflows, and it is itself below +inf.
    (console.log "max*2 = +inf        :" (== (* MAX_VALUE 2.0) INF))
    (console.log "max < +inf          :" (< MAX_VALUE INF))
    (console.log "-inf < 0            :" (< NEG_INF 0.0))
    (console.log "min_normal > 0      :" (> MIN_NORMAL 0.0))
    ;; NaN is the sole value not equal to itself -- the only portable NaN test.
    (console.log "nan == nan          :" (== NAN NAN)))

;; std/math/special -- the special functions (gamma, beta, error function) exercised against the
;; closed forms that pin their digits.
;;
;; Every golden is DERIVED, not captured:
;;   * Gamma extends factorial: gamma(n) = (n-1)!, so gamma(5) = 4! = 24, and the half-integers are
;;     gamma(1/2) = sqrt(pi) = 1.772454, gamma(3/2) = sqrt(pi)/2 = 0.886227.
;;   * lgamma is the overflow-proof log: lgamma(5) = ln(24) = 3.178054, and lgamma(171) stays finite
;;     where gamma(171) has already overflowed a double.
;;   * Beta from gammas: B(a,b) = gamma(a)gamma(b)/gamma(a+b), so B(2,3) = 1!*2!/4! = 1/12 = 0.083333
;;     and B(1/2,1/2) = gamma(1/2)^2/gamma(1) = pi = 3.141593.
;;   * The error function: erf(0) = 0, erf(1) = 0.842701, erf(2) = 0.995322, it is odd
;;     (erf(-1) = -erf(1)), and erf(x) + erfc(x) = 1 exactly -- the identity is the test.
;;   * factorial-real / binomial-real route through gamma but land on integers: 5! = 120,
;;     C(52,5) = 2598960 (rounded back from the gamma path's last-ULP dust).
;;
;; gamma/erf are approximations (Lanczos for gamma, a rational/series for erf), so their libm-routed
;; results round to 6 places, where node's and clang's last ULP cannot split the digit. The integer
;; landings (factorial, binomial) round to the whole number they are.

(import "std/math/special")

(
    ;; Round to 6 decimals. The trailing `(+ 0.0 ...)` normalizes a signed zero to +0: this classic
    ;; erf approximation is ~-3e-8 at x=0 (documented in the module), which rounds to -0, and -0 + 0 is
    ;; +0 in IEEE on both backends -- so erf(0) prints the exact mathematical 0, not "-0".
    (fn r6 [x <- Real] -> Real (+ 0.0 (/ (Math.round (* x 1000000.0)) 1000000.0)))

    (console.log "-- gamma extends factorial: gamma(n) = (n-1)! --")
    (console.log "gamma 1      =" (r6 (gamma 1.0)))
    (console.log "gamma 2      =" (r6 (gamma 2.0)))
    (console.log "gamma 3      =" (r6 (gamma 3.0)))
    (console.log "gamma 4      =" (r6 (gamma 4.0)))
    (console.log "gamma 5      =" (r6 (gamma 5.0)))
    (console.log "gamma 0.5    =" (r6 (gamma 0.5)))       ;; sqrt(pi)
    (console.log "gamma 1.5    =" (r6 (gamma 1.5)))       ;; sqrt(pi)/2

    (console.log "-- lgamma: the overflow-proof log --")
    (console.log "lgamma 5     =" (r6 (lgamma 5.0)))      ;; ln(24)
    (console.log "lgamma 171   =" (r6 (lgamma 171.0)))    ;; finite where gamma(171) overflows

    (console.log "-- beta from gammas --")
    (console.log "beta 2 3     =" (r6 (beta 2.0 3.0)))    ;; 1/12
    (console.log "beta 1 1     =" (r6 (beta 1.0 1.0)))    ;; 1
    (console.log "beta .5 .5   =" (r6 (beta 0.5 0.5)))    ;; pi

    (console.log "-- error function --")
    (console.log "erf 0        =" (r6 (erf 0.0)))
    (console.log "erf 1        =" (r6 (erf 1.0)))
    (console.log "erf 2        =" (r6 (erf 2.0)))
    (console.log "erf -1       =" (r6 (erf -1.0)))        ;; odd: -erf(1)
    (console.log "erfc 0       =" (r6 (erfc 0.0)))
    (console.log "erfc 1       =" (r6 (erfc 1.0)))
    (console.log "erf+erfc = 1 =" (r6 (+ (erf 1.3) (erfc 1.3))))   ;; the identity

    (console.log "-- factorial / binomial via gamma, landing on integers --")
    (console.log "fact-real 0  =" (Math.round (factorial-real 0.0)))
    (console.log "fact-real 5  =" (Math.round (factorial-real 5.0)))
    (console.log "fact-real 10 =" (Math.round (factorial-real 10.0)))
    (console.log "lfact 10     =" (r6 (lfactorial 10.0)))          ;; ln(3628800)
    (console.log "binom 10 3   =" (Math.round (binomial-real 10.0 3.0)))
    (console.log "binom 52 5   =" (Math.round (binomial-real 52.0 5.0)))
    (console.log "lbinom 10 3  =" (r6 (lbinomial 10.0 3.0)))       ;; ln(120)
)

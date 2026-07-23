;; std/math/integrate -- quadrature and root-finding exercised against exact closed forms.
;;
;; The integrand is an OBJECT, not a passed function: `(call f args)` does not spread in l-lang, so a
;; bare function value of one Real cannot be invoked portably. Each integrand below is therefore a
;; one-method class implementing `RealFn` -- `(at x)`. Newton additionally needs the derivative, given
;; as a SECOND RealFn.
;;
;; EVERY GOLDEN IS DERIVED FROM MATHEMATICS, never pasted from output:
;;   * The exact integrals: ∫x^2 on [0,1] = 1/3, ∫sin on [0,pi] = 2, ∫x^3 on [0,2] = 4.
;;   * The exact trapezoid ERRORS, from the Euler-Maclaurin leading term, so the deliberately-coarse
;;     trapezoid values are predicted, not observed: for x^2 on [0,1] with n=100 the error is
;;     +(b-a)h^2 f''/12 = (0.01^2)(2)/12 = 1.667e-5, giving 1/3 + 1.667e-5 = 0.33335 exactly; for sin
;;     on [0,pi] with n=1000 it is -h^2/6 = -(pi/1000)^2/6 = -1.645e-6, giving 2 - 1.645e-6 = 1.999998.
;;   * Simpson is exact for cubics, so ∫x^3 = 4 comes out at 4 with only n=2 panels while one trapezoid
;;     panel gives 5 -- the O(h^4)-vs-O(h^2) gap made visible.
;;   * The roots: sqrt(2) = 1.414214 (root of x^2-2); the real root of x^3-x-2 is 1.521380 (Cardano),
;;     cross-checked by two independent methods agreeing.
;;
;; Results are rounded to 6 places (`r6`): the quadrature of sin routes through libm, whose last ULP
;; can differ between node and clang, and rounding is what keeps the golden backend-independent. The
;; iteration COUNTS are never pinned (they are implementation detail); only the mathematically forced
;; RELATIONS are -- a superlinear/quadratic method beats linear bisection to a tight tolerance.

(import "std/math/integrate")
(import "std/math/elementary")

(
    ;; Round to 6 decimals -- libm's last-ULP wobble on sin cannot reach the 6th place, and `round`
    ;; (ties toward +Infinity) is itself IEEE, so the rounded value is byte-identical on both backends.
    (fn r6 [x <- Real] -> Real (/ (round (* x 1000000.0)) 1000000.0))

    (let PI 3.141592653589793)

    ;; -- integrands, each a one-method RealFn ------------------------------------------------------
    (defclass Sq   :implements RealFn (fn at [x <- Real] -> Real (return (* x x))))
    (defclass Cube :implements RealFn (fn at [x <- Real] -> Real (return (* x (* x x)))))
    (defclass Sine :implements RealFn (fn at [x <- Real] -> Real (return (Math.sin x))))

    ;; f(x)=x^2-2, root sqrt(2); derivative 2x
    (defclass F2  :implements RealFn (fn at [x <- Real] -> Real (return (- (* x x) 2.0))))
    (defclass DF2 :implements RealFn (fn at [x <- Real] -> Real (return (* 2.0 x))))
    ;; f(x)=x^3-x-2, real root 1.521380; derivative 3x^2-1
    (defclass F3  :implements RealFn (fn at [x <- Real] -> Real (return (- (- (* x (* x x)) x) 2.0))))
    (defclass DF3 :implements RealFn (fn at [x <- Real] -> Real (return (- (* 3.0 (* x x)) 1.0))))
    ;; f(x)=x^2+1, NO real root -- Newton has nowhere to converge
    (defclass NR  :implements RealFn (fn at [x <- Real] -> Real (return (+ (* x x) 1.0))))
    (defclass DNR :implements RealFn (fn at [x <- Real] -> Real (return (* 2.0 x))))

    ;; -- quadrature vs exact closed forms ----------------------------------------------------------
    (console.log "-- integral of x^2 on [0,1] = 1/3 --")
    (console.log "trapezoid n=100  =" (r6 (trapezoid (Sq) 0.0 1.0 100)))    ;; O(h^2): 1/3+1.667e-5 = 0.33335
    (console.log "simpson   n=100  =" (r6 (simpson   (Sq) 0.0 1.0 100)))    ;; O(h^4): 0.333333
    (console.log "adaptive  1e-9   =" (r6 (adaptive-simpson (Sq) 0.0 1.0 1.0e-9)))

    (console.log "-- integral of sin on [0,pi] = 2 --")
    (console.log "trapezoid n=1000 =" (r6 (trapezoid (Sine) 0.0 PI 1000)))  ;; O(h^2): 2-1.645e-6 = 1.999998
    (console.log "simpson   n=100  =" (r6 (simpson   (Sine) 0.0 PI 100)))
    (console.log "adaptive  1e-9   =" (r6 (adaptive-simpson (Sine) 0.0 PI 1.0e-9)))

    (console.log "-- Simpson is EXACT for cubics: integral of x^3 on [0,2] = 4 --")
    (console.log "simpson   n=2    =" (r6 (simpson   (Cube) 0.0 2.0 2)))    ;; exact -> 4
    (console.log "trapezoid n=2    =" (r6 (trapezoid (Cube) 0.0 2.0 2)))    ;; one panel -> 5, way off

    ;; -- root-finding: sqrt(2), the root of x^2-2 --------------------------------------------------
    (console.log "-- root of x^2-2 = sqrt(2) = 1.414214 --")
    (let f2 (F2))
    (let df2 (DF2))
    (let rb (bisect f2 1.0 2.0 1.0e-12 200))
    (console.log "bisect x =" (r6 rb.x) "conv =" rb.converged)
    (let rn (newton f2 df2 1.0 1.0e-12 100))
    (console.log "newton x =" (r6 rn.x) "conv =" rn.converged)
    (let rs (secant f2 1.0 2.0 1.0e-12 100))
    (console.log "secant x =" (r6 rs.x) "conv =" rs.converged)
    ;; Convergence-ORDER facts, not pasted counts: bisection is linear (~log2(1/tol) steps), Newton is
    ;; quadratic and secant superlinear, so both reach 1e-12 in far fewer steps -- and bisection's own
    ;; step count is bounded by log2((2-1)/1e-12) ~ 40.
    (console.log "newton faster than bisect =" (< rn.iters rb.iters))
    (console.log "secant faster than bisect =" (< rs.iters rb.iters))
    (console.log "bisect iters <= 60        =" (<= rb.iters 60))

    ;; -- root-finding: the real root of x^3-x-2 = 1.521380 -----------------------------------------
    (console.log "-- root of x^3-x-2 = 1.521380 --")
    (let f3 (F3))
    (let df3 (DF3))
    (let cb (bisect f3 1.0 2.0 1.0e-12 200))
    (console.log "bisect x =" (r6 cb.x) "conv =" cb.converged)
    (let cn (newton f3 df3 1.5 1.0e-12 100))
    (console.log "newton x =" (r6 cn.x) "conv =" cn.converged)

    ;; -- failure modes: NOTHING TRAPS, the status is #f --------------------------------------------
    (console.log "-- failure modes return converged=#f, never a trap --")
    (let nr (NR))
    (let dnr (DNR))
    (let frn (newton nr dnr 1.0 1.0e-12 100))            ;; x^2+1 has no real root
    (console.log "newton x^2+1 (no root) conv =" frn.converged)
    (let flat (newton f2 df2 0.0 1.0e-12 100))           ;; f'(0)=0, flat spot
    (console.log "newton from f'=0 spot  conv =" flat.converged)
    (let nb (bisect f2 3.0 4.0 1.0e-12 200))             ;; f(3),f(4) same sign, no bracket
    (console.log "bisect no sign change  conv =" nb.converged)
)

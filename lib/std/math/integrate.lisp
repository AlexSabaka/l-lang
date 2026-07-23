;; std/math/integrate -- numerical quadrature and root-finding over a real function of one variable.
;;
;; Depends only on std/math/elementary (for `abs`). Everything else is built here from `+ - * /`, the
;; IEEE-correctly-rounded ops, so a result that is not routed through libm is byte-identical on both
;; backends; the goldens still round, because some integrands (`sin`) route through libm and carry the
;; last-ULP wobble elementary.lisp documents.
;;
;; -----------------------------------------------------------------------------------------------
;; HOW A CALLER SUPPLIES THE INTEGRAND -- and why it is an interface, not a function value.
;;
;; The natural spelling is "pass the function": `(trapezoid sin 0 pi 100)`. It cannot work here.
;; `(call f args)` does NOT spread -- it compiles to `f(args)`, handing the callback the whole argument
;; vector as one value (D-note in std/sys/timers: `(call double [21])` answers 42 on JS by coercion and
;; TRAPS on C). So a first-class function taking one Real cannot be invoked portably at all.
;;
;; The portable channel is NOMINAL METHOD DISPATCH, which both backends already lower correctly for
;; every class/interface in the corpus. So the integrand is an object implementing `RealFn` -- a single
;; method `(at x)` -- and every routine below calls `(f.at x)`. The caller writes a one-method class:
;;
;;     (defclass Sq :implements RealFn (fn at [x <- Real] -> Real (return (* x x))))
;;     (trapezoid (Sq) 0.0 1.0 1000)
;;
;; This is the same decision std/sys/timers reached for its callbacks, for the same measured reason.
;; The cost is a class per integrand; the benefit is that it runs identically on both backends.
;;
;; Newton needs the DERIVATIVE too. Rather than a second interface (a `DiffFn` with `at`+`deriv`, which
;; would force covariance rules to make it usable where a bare `RealFn` is expected), Newton simply
;; takes TWO `RealFn`s: `f` and `df`. Explicit, no new type, and it makes the caller state the
;; derivative it is responsible for -- Newton is only as good as the `df` you hand it.
;;
;; -----------------------------------------------------------------------------------------------
;; NOTHING HERE TRAPS. A runtime trap (divide-by-zero on Int, out-of-bounds) is catchable on JS and
;; FATAL on C, so a library that trapped on a bad bracket would abort the whole C program with no
;; diagnostic. Every fallible routine RETURNS A STATUS instead: the root-finders answer a `RootResult`
;; carrying `converged`, and `adaptive-simpson` is depth-capped and returns its best estimate rather
;; than recursing without bound. A caller checks `converged`; it is never handed a silent wrong answer
;; dressed as a real one.
(
    (import "std/math/elementary")

    ;; -- the integrand channel ---------------------------------------------------------------------

    ;; A real-valued function of one real variable, supplied as an object. See the header for why this
    ;; is an interface and not a passed function: `(call f args)` does not spread, so a bare function
    ;; value cannot be invoked portably.
    (definterface RealFn
        (fn at [x <- Real] -> Real))

    ;; What a root-finder answers. `converged` is the load-bearing field -- it is #f when the bracket
    ;; had no sign change, the slope went flat, or the iteration cap was hit, and in those cases `x` is
    ;; the best estimate reached, NOT a root. `iters` is how many steps were spent (bounded, so it is a
    ;; portable measure of how hard the root was to find, but derive any golden over it from the
    ;; convergence RATE, never by pasting the printed count).
    (defclass RootResult
        (mut :ctor x <- Real)
        (mut :ctor iters <- Int)
        (mut :ctor converged <- Boolean))

    ;; A slope (Newton) or a secant denominator this small is treated as flat: the step would divide by
    ;; ~0 and fly off. 1e-13 is chosen well above the 2.2e-16 machine epsilon (so a genuinely tiny but
    ;; real slope near a root is not falsely rejected) and well below any slope a normal root has, so in
    ;; practice it only fires at an actual stationary point -- which is exactly where Newton has no step.
    (let FLAT 1.0e-13)

    ;; -- quadrature: three rules, three error orders -----------------------------------------------

    ;; COMPOSITE TRAPEZOID over n equal panels. GLOBAL ERROR O(h^2) with h=(b-a)/n: precisely
    ;; -(b-a)/12 * h^2 * f''(xi) for some xi in [a,b]. Exact for straight lines (f''=0); halving h
    ;; quarters the error. DEGRADES where f'' is large or undefined (a kink, a spike) -- there the
    ;; O(h^2) constant blows up and you want the adaptive rule instead. `(+ 0.0 i)` / `(+ 0.0 n)` is the
    ;; Int->Real promotion (`cast<Real>` is not implemented in the compiler today).
    (fn trapezoid [f <- RealFn a <- Real b <- Real n <- Int] -> Real
        (if (<= n 0) (return 0.0))
        (let h (/ (- b a) (+ 0.0 n)))
        (mut s <- Real (* 0.5 (+ (f.at a) (f.at b))))
        (mut i <- Int 1)
        (while (< i n) (
            (let x (+ a (* (+ 0.0 i) h)))
            (s := (+ s (f.at x)))
            (i := (+ i 1))))
        (return (* s h)))

    ;; COMPOSITE SIMPSON. GLOBAL ERROR O(h^4): -(b-a)/180 * h^4 * f''''(xi). Two orders better than
    ;; trapezoid for the same n, and EXACT for any polynomial up to degree 3 (the parabola through each
    ;; triple integrates a cubic exactly -- the odd-degree error cancels by symmetry). Needs an EVEN
    ;; panel count; an odd or too-small n is rounded UP to the next even >= 2 rather than rejected,
    ;; because silently returning 0 or trapping would both be worse than one extra panel. DEGRADES, like
    ;; trapezoid, where the relevant derivative (here f'''') is large or the integrand is non-smooth.
    (fn simpson [f <- RealFn a <- Real b <- Real n <- Int] -> Real
        (mut m <- Int n)
        (if (< m 2) (m := 2))
        (if (== (% m 2) 1) (m := (+ m 1)))
        (let h (/ (- b a) (+ 0.0 m)))
        (mut s <- Real (+ (f.at a) (f.at b)))
        (mut i <- Int 1)
        (while (< i m) (
            (let x (+ a (* (+ 0.0 i) h)))
            (if (== (% i 2) 1)
                (s := (+ s (* 4.0 (f.at x))))
                (s := (+ s (* 2.0 (f.at x)))))
            (i := (+ i 1))))
        (return (* (/ h 3.0) s)))

    ;; Simpson's rule on a SINGLE panel [a,b] given its three sampled values -- the atom the adaptive
    ;; routine refines. (b-a)/6 * (fa + 4 fm + fb).
    (fn simpson1 [a <- Real b <- Real fa <- Real fb <- Real fm <- Real] -> Real
        (return (* (/ (- b a) 6.0) (+ fa (+ (* 4.0 fm) fb)))))

    ;; The recursive heart of adaptive Simpson. Compares the one-panel estimate `whole` against the sum
    ;; of the two half-panel estimates; their difference over 15 is the Richardson error estimate (the
    ;; leading O(h^4) term scales by 1/16 when h halves, so left+right - whole is 15x the half-panel
    ;; error). If that is within tolerance we accept left+right PLUS the /15 correction -- which is the
    ;; O(h^6) extrapolated value, better than either Simpson estimate for free. Otherwise recurse into
    ;; each half with HALF the tolerance, so the accepted local errors sum to the global one.
    ;;
    ;; `depth` is a hard recursion fence: on hitting 0 we accept the current estimate rather than
    ;; recursing forever on a pathological integrand (a discontinuity the tolerance can never satisfy).
    ;; That is the no-trap guarantee -- a runaway recursion would overflow the C stack, which is fatal.
    (fn adapt [f <- RealFn a <- Real b <- Real fa <- Real fb <- Real fm <- Real
               whole <- Real tol <- Real depth <- Int] -> Real
        (let m (* 0.5 (+ a b)))
        (let lm (* 0.5 (+ a m)))
        (let rm (* 0.5 (+ m b)))
        (let flm (f.at lm))
        (let frm (f.at rm))
        (let left (simpson1 a m fa fm flm))
        (let right (simpson1 m b fm fb frm))
        (let delta (- (+ left right) whole))
        (if (or (<= depth 0) (<= (abs delta) (* 15.0 tol)))
            (return (+ (+ left right) (/ delta 15.0))))
        (return (+ (adapt f a m fa fm flm left (* 0.5 tol) (- depth 1))
                   (adapt f m b fm fb frm right (* 0.5 tol) (- depth 1)))))

    ;; ADAPTIVE SIMPSON to a requested tolerance. Spends panels where the integrand is hard and coasts
    ;; where it is easy, so it beats fixed-n Simpson on integrands with a localised feature (a sharp
    ;; peak on an otherwise flat interval). The error is controlled to roughly `tol` via the Richardson
    ;; estimate in `adapt`. Depth is capped at 50 (2^50 panels is far past any real need); on exhaustion
    ;; it returns the best estimate for that subinterval rather than trapping. Not a status type: unlike
    ;; the root-finders it always produces a number, and the depth cap only bites on integrands no fixed
    ;; rule would handle either.
    (fn adaptive-simpson [f <- RealFn a <- Real b <- Real tol <- Real] -> Real
        (let m (* 0.5 (+ a b)))
        (let fa (f.at a))
        (let fb (f.at b))
        (let fm (f.at m))
        (let whole (simpson1 a b fa fb fm))
        (return (adapt f a b fa fb fm whole tol 50)))

    ;; -- root-finding: three methods, three trade-offs ---------------------------------------------

    ;; BISECTION. The robust one: given f(a) and f(b) of OPPOSITE sign and f continuous, a root in [a,b]
    ;; is GUARANTEED and this cannot fail to find it. Convergence is LINEAR -- exactly one bit of the
    ;; answer per iteration, the interval halving each step -- so reaching tolerance `tol` costs about
    ;; log2((b-a)/tol) steps (~40 for a unit interval to 1e-12). Slow, but unconditional.
    ;;
    ;; No sign change => converged=#f immediately: bisection is undefined without a bracket, and pushing
    ;; on would just report the midpoint as a root it is not. An endpoint that is already a root is
    ;; returned exactly. REACH FOR IT when you can bracket the root and want a guarantee over speed, or
    ;; as the safe first stage before polishing with Newton/secant.
    (fn bisect [f <- RealFn a <- Real b <- Real tol <- Real max-iter <- Int] -> RootResult
        (mut lo <- Real a)
        (mut hi <- Real b)
        (let fa (f.at lo))
        (let fb (f.at hi))
        (if (== fa 0.0) (return (RootResult lo 0 #t)))
        (if (== fb 0.0) (return (RootResult hi 0 #t)))
        (if (> (* fa fb) 0.0) (return (RootResult (* 0.5 (+ lo hi)) 0 #f)))
        (mut flo <- Real fa)
        (mut mid <- Real (* 0.5 (+ lo hi)))
        (mut i <- Int 0)
        (while (< i max-iter) (
            (mid := (* 0.5 (+ lo hi)))
            (let fm (f.at mid))
            (if (or (== fm 0.0) (<= (* 0.5 (- hi lo)) tol))
                (return (RootResult mid (+ i 1) #t)))
            (if (< (* flo fm) 0.0)
                (hi := mid)
                ((lo := mid) (flo := fm)))
            (i := (+ i 1))))
        (return (RootResult mid max-iter #f)))

    ;; NEWTON-RAPHSON. The fast one: near a SIMPLE root convergence is QUADRATIC -- the number of
    ;; correct digits roughly doubles each step, so 4-5 iterations from a decent guess is typical. The
    ;; price is a derivative (`df`, supplied as a second RealFn -- see the header) and a good starting
    ;; point.
    ;;
    ;; IT DOES NOT ALWAYS CONVERGE, and this is not a corner case: a guess near a stationary point
    ;; (f'~0) throws the next iterate far away, and some f/x0 pairs cycle or diverge outright. So the
    ;; iteration count is CAPPED and a flat slope (|f'| <= FLAT) bails. ON FAILURE the result is
    ;; converged=#f with `x` the last iterate reached -- a value the caller MUST check before trusting,
    ;; because it is not a root. REACH FOR IT when the derivative is cheap and you have a good guess.
    (fn newton [f <- RealFn df <- RealFn x0 <- Real tol <- Real max-iter <- Int] -> RootResult
        (mut x <- Real x0)
        (mut i <- Int 0)
        (while (< i max-iter) (
            (let fx (f.at x))
            (if (<= (abs fx) tol) (return (RootResult x i #t)))
            (let dfx (df.at x))
            (if (<= (abs dfx) FLAT) (return (RootResult x i #f)))
            (let xn (- x (/ fx dfx)))
            (if (<= (abs (- xn x)) tol) (return (RootResult xn (+ i 1) #t)))
            (x := xn)
            (i := (+ i 1))))
        (return (RootResult x max-iter #f)))

    ;; SECANT. The middle ground: SUPERLINEAR convergence of order phi (~1.618) -- slower than Newton's
    ;; quadratic but far faster than bisection, and it needs NO DERIVATIVE, approximating the slope from
    ;; the last two points instead. It needs two starting points, `x0` and `x1`.
    ;;
    ;; Like Newton it can fail: if two successive f-values coincide the secant line is horizontal and
    ;; the step is undefined (|f(b)-f(a)| <= FLAT bails), and a bad pair can diverge -- so it is capped
    ;; and returns converged=#f on failure, `x` being the last iterate. REACH FOR IT when you want
    ;; Newton-like speed but have no derivative (or it is expensive to evaluate).
    (fn secant [f <- RealFn x0 <- Real x1 <- Real tol <- Real max-iter <- Int] -> RootResult
        (mut pa <- Real x0)
        (mut pb <- Real x1)
        (mut fa <- Real (f.at pa))
        (mut fb <- Real (f.at pb))
        (mut i <- Int 0)
        (while (< i max-iter) (
            (if (<= (abs fb) tol) (return (RootResult pb i #t)))
            (let denom (- fb fa))
            (if (<= (abs denom) FLAT) (return (RootResult pb i #f)))
            (let c (- pb (/ (* fb (- pb pa)) denom)))
            (if (<= (abs (- c pb)) tol) (return (RootResult c (+ i 1) #t)))
            (pa := pb)
            (fa := fb)
            (pb := c)
            (fb := (f.at c))
            (i := (+ i 1))))
        (return (RootResult pb max-iter #f)))

    (export
        RealFn RootResult
        trapezoid simpson adaptive-simpson
        bisect newton secant)
)

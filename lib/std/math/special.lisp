;; std/math/special -- the special functions: gamma, log-gamma, beta, erf/erfc, and the log-domain
;; factorial/binomial that survive arguments the exact integer versions cannot.
;;
;; TWO NAIVE TRAPS DEFINE THIS MODULE, and every choice below is one of them being sidestepped.
;;
;;   1. A NAIVE GAMMA OVERFLOWS ALMOST IMMEDIATELY. Gamma grows factorially: Gamma(171) ~ 7.3e306 is
;;      already the last value that fits a double, and Gamma(172) is +inf. So the product form of
;;      anything built on it -- beta = Gamma(a)Gamma(b)/Gamma(a+b), the binomial coefficient -- blows
;;      the numerator to +inf and returns +inf/+inf = NaN while the TRUE answer is a perfectly finite
;;      number. The fix is the whole reason `lgamma` (log|Gamma|) is the primitive here and `gamma`
;;      is the derived convenience: logs turn every factorial-scale product into a SUM that stays in
;;      range to arguments in the billions. `beta`, `lfactorial`, `lbinomial` are all lgamma sums; the
;;      raw `gamma` is offered only because callers ask for it, and it is the one function here that
;;      overflows (documented at its definition).
;;
;;   2. A NAIVE ERF LOSES PRECISION IN THE TAIL. For x beyond ~2, erf(x) is a hair under 1 and erfc(x)
;;      = 1 - erf(x) is tiny; computing erfc that way SUBTRACTS two nearly-equal numbers and keeps only
;;      the noise -- erfc(3) is 2.2e-5, and 1 - 0.99997791 delivers maybe three good digits of it. So
;;      `erfc` is the PRIMITIVE (a direct approximation that never forms 1 - erf), and `erf` is the
;;      derived `1 - erfc`. That direction is the safe one: erf(large) ~ 1 inherits erfc's tiny
;;      absolute error, no cancellation; it is only the reverse that destroys precision.
;;
;; -----------------------------------------------------------------------------------------------
;; ACCURACY, STATED PER FAMILY, WITH THE REGIME EACH DEGRADES IN.
;;
;; * lgamma / gamma / beta / the log-factorials -- Lanczos approximation, g=5, six coefficients
;;   (Lanczos 1964; the coefficient set and the driver are Numerical Recipes in C 2e, sec. 6.1,
;;   `gammln`). Bound: |relative error| < 2e-10 across the whole positive real axis -- MEASURED against
;;   libm this session it is far better than that near integers and half-integers (~1e-13), 2e-10 is
;;   the honest worst case. It DEGRADES two ways: below x=0.5 the reflection formula routes through
;;   sin(pi*x), which loses relative precision as x nears a negative integer (a true pole), and only
;;   the pole at x=0 is caught exactly; and `gamma` itself overflows to +inf past x~171 (trap 1) --
;;   that is not an approximation error, it is the double's range, and it is exactly why you should be
;;   calling `lgamma`.
;;
;; * erf / erfc -- the Chebyshev-fitted rational-times-Gaussian of Numerical Recipes sec. 6.2
;;   (`erfcc`), which is the A&S 7.1.26-family form carried to nine inner coefficients. Bound:
;;   |FRACTIONAL error| < 1.2e-7 for ALL x, tail included -- a relative bound, which is the whole point
;;   over the plain A&S 7.1.26 polynomial (that one carries an ABSOLUTE 1.5e-7 bound and so goes
;;   relatively worthless once erfc drops below ~1e-7). It DEGRADES near x=0 in the OTHER direction:
;;   `erf` = 1 - erfc subtracts from 1 when erfc ~ 1, so erf of a small argument keeps a couple of
;;   digits fewer than erfc does there. A dedicated Maclaurin series erf(x) = (2/sqrt(pi))(x - x^3/3 +
;;   ...) is the fix for |x| < ~0.5 if that regime ever matters; it is not built (out of scope, and
;;   the corpus does not exercise sub-0.5 erf to more than 5 places).
;;
;; A GOLDEN over anything here rounds to fixed decimals: the two backends' libm `exp`/`log`/`sin`
;; differ in the last ULP (~1e-16 relative), which is far below any rounded digit but would split a
;; full-precision pin. The example asserts 5-6 decimal places, derived from mathematics.
;;
;; -----------------------------------------------------------------------------------------------
;; SELF-CONTAINED: imports nothing. The declared dependency was `elementary`, but the special
;; functions are built from `Math.exp`/`log`/`sin`/`sqrt`/`abs` (D50 floor entries, ambient on both
;; backends) and from IEEE `+ - * /` -- none of elementary's gap-fillers (log1p, the hyperbolics,
;; hypot) turned out to be on the path, so importing it would add a compile-time dependency for zero
;; used symbols and pull the whole sibling into `06_special`'s co-processing for nothing. `PI` is the
;; one constant needed (the reflection formula); it is a file-local literal exactly as `elementary`
;; keeps its own -- `constants` owns the exported `PI`, and a decimal literal carries no libm, so the
;; two are the same double with no second owner of the exported name.
(
    ;; The nearest double to pi. File-local and unexported: identical to `constants`' exported PI to
    ;; the bit (a literal, no libm), so even if the co-processed flat resolver saw both it could only
    ;; bind the same value -- the same latitude `elementary`'s local PI already takes.
    (let PI 3.141592653589793)

    ;; -- log-gamma: the Lanczos core ---------------------------------------------------------------
    ;;
    ;; log Gamma(x) for x > 0, by the Lanczos series. This is THE numerical primitive of the module;
    ;; everything factorial-scale is a sum of these. Distinctly named `lgamma-lanczos` rather than a
    ;; second `lgamma` because it is co-processed with its siblings (D35/Mb) and must not answer to a
    ;; name another module claims -- and because the public `lgamma` below wraps it with reflection.
    ;;
    ;; The form is Numerical Recipes' `gammln`: a rational series in `x` shifted by g+1/2 = 5.5,
    ;; multiplied by sqrt(2*pi) (the literal 2.5066282746310005) and the (x+0.5)*log(x+5.5) - (x+5.5)
    ;; Stirling-like envelope. `ser` starts at the Lanczos c0 and accumulates c_k/(x+k); the six
    ;; coefficients are Lanczos 1964's, given to the digits that round-trip a double:
    ;;
    ;;     c0 =  1.000000000190015
    ;;     c1 =  76.18009172947146     c2 = -86.50532032941677
    ;;     c3 =  24.01409824083091     c4 =  -1.231739572450155
    ;;     c5 =   0.1208650973866179e-2 c6 = -0.5395239384953e-5
    ;;
    ;; The loop is unrolled: `ser`'s six terms are added by hand, each dividing the next coefficient
    ;; by an incremented `y`. Unrolled rather than looped over a `[Real]` literal so there is no array
    ;; index and no risk that the negative-coefficient vector literal lexes differently on the two
    ;; backends -- the arithmetic is identical either way and this form has the fewest moving parts.
    (fn lgamma-lanczos [x <- Real] -> Real
        (mut y <- Real x)
        (mut tmp <- Real (+ x 5.5))
        (tmp := (- tmp (* (+ x 0.5) (Math.log tmp))))
        (mut ser <- Real 1.000000000190015)
        (y := (+ y 1.0))
        (ser := (+ ser (/ 76.18009172947146 y)))
        (y := (+ y 1.0))
        (ser := (+ ser (/ -86.50532032941677 y)))
        (y := (+ y 1.0))
        (ser := (+ ser (/ 24.01409824083091 y)))
        (y := (+ y 1.0))
        (ser := (+ ser (/ -1.231739572450155 y)))
        (y := (+ y 1.0))
        (ser := (+ ser (/ 0.1208650973866179e-2 y)))
        (y := (+ y 1.0))
        (ser := (+ ser (/ -0.5395239384953e-5 y)))
        (return (+ (- 0.0 tmp) (Math.log (/ (* 2.5066282746310005 ser) x)))))

    ;; log|Gamma(x)| for any real x. For x >= 0.5 it is the Lanczos core directly (Gamma > 0 there, so
    ;; the log is real). Below 0.5 it reflects: |Gamma(x)| = pi / (|sin(pi*x)| * Gamma(1-x)), and since
    ;; 1-x > 0.5 the right side is one Lanczos call. Taking |sin| keeps this the log of the MAGNITUDE
    ;; (Gamma alternates sign on the negatives); a caller wanting the signed Gamma there uses `gamma`,
    ;; which carries the sign through sin without the absolute value. sin(pi*x) is exactly 0 only at
    ;; x=0 here (the argument is a machine integer times pi), so that single pole is caught and returns
    ;; +inf; the negative-integer poles land on a tiny non-zero sin and return a large finite value
    ;; instead -- documented, not special-cased, because the module's domain is x > 0.
    (fn lgamma [x <- Real] -> Real
        (if (< x 0.5)
            (
                (let s (Math.abs (Math.sin (* PI x))))
                (if (== s 0.0) (return (/ 1.0 0.0)))
                (return (- (Math.log (/ PI s)) (lgamma-lanczos (- 1.0 x))))
            ))
        (return (lgamma-lanczos x)))

    ;; Gamma(x). Exp of the Lanczos core for x >= 0.5; the sign-carrying reflection below it. This is
    ;; the function that OVERFLOWS (trap 1): Gamma(172) is +inf, so anything that would multiply
    ;; several of these together must go through `lgamma`/`lbeta`/`lbinomial` instead and exponentiate
    ;; once at the end -- which is exactly what the factorial/binomial helpers do. Kept because a
    ;; caller who knows the argument is modest wants the value, not its log; `gamma(6)` = 120, not 4.79.
    (fn gamma [x <- Real] -> Real
        (if (< x 0.5)
            (
                (let s (Math.sin (* PI x)))
                (if (== s 0.0) (return (/ 1.0 0.0)))
                (return (/ PI (* s (Math.exp (lgamma-lanczos (- 1.0 x))))))
            ))
        (return (Math.exp (lgamma-lanczos x))))

    ;; -- beta --------------------------------------------------------------------------------------
    ;;
    ;; log B(a,b) = logGamma(a) + logGamma(b) - logGamma(a+b), for a,b > 0. This is the honest
    ;; primitive: B(a,b) = Gamma(a)Gamma(b)/Gamma(a+b) computed as written overflows the moment a or b
    ;; passes ~171 (Gamma(a) alone is +inf) even though B itself is a small finite number, so the
    ;; product form is a trap-1 casualty. Summing logs never leaves range.
    (fn lbeta [a <- Real b <- Real] -> Real
        (return (- (+ (lgamma a) (lgamma b)) (lgamma (+ a b)))))

    ;; B(a,b), the value. Safe wherever B itself fits a double even when the individual Gammas do not,
    ;; because it exponentiates the log form once at the end. B(0.5,0.5) = pi; B(2,3) = 1/12.
    (fn beta [a <- Real b <- Real] -> Real
        (return (Math.exp (lbeta a b))))

    ;; -- erf / erfc --------------------------------------------------------------------------------
    ;;
    ;; erfc(x), the complementary error function, as the PRIMITIVE (trap 2). Numerical Recipes' erfcc:
    ;; t = 1/(1 + |x|/2), then t * exp(-x^2 - 1.26551223 + t*P(t)) with P a nine-term polynomial, a
    ;; Chebyshev fit to the A&S 7.1.26 family carrying |fractional error| < 1.2e-7 everywhere. The
    ;; reflection for x < 0 is erfc(-x) = 2 - erfc(x) (erfc(x) = 1 - erf(x) and erf is odd).
    ;;
    ;; No infinity guard: at x = +inf, t = 1/(1+inf) = 0 and the exp argument goes to -inf, so the
    ;; result is 0*0 = 0 (MEASURED, not inf*0 = NaN -- both factors are +0, their product is +0); at
    ;; -inf the reflection gives 2 - 0 = 2. So erfc(+inf) = 0, erfc(-inf) = 2 fall out of the arithmetic
    ;; with no branch, and `erf` inherits erf(+inf) = 1, erf(-inf) = -1.
    (fn erfc [x <- Real] -> Real
        (let z (Math.abs x))
        (let t (/ 1.0 (+ 1.0 (* 0.5 z))))
        (let p (+ 1.00002368 (* t (+ 0.37409196 (* t (+ 0.09678418 (* t (+ -0.18628806
                (* t (+ 0.27886807 (* t (+ -1.13520398 (* t (+ 1.48851587
                (* t (+ -0.82215223 (* t 0.17087277)))))))))))))))))
        (let ans (* t (Math.exp (+ (- 0.0 (* z z)) (+ -1.26551223 (* t p))))))
        (if (>= x 0.0) (return ans))
        (return (- 2.0 ans)))

    ;; erf(x) = 1 - erfc(x). The derived direction, and the SAFE one: for large x, erf ~ 1 and this
    ;; subtraction keeps erfc's tiny absolute error with no cancellation; it is only the reverse
    ;; (erfc = 1 - erf) that loses the tail. erf(0) is not exactly 0 here -- erfc(0) is 1.00000003 off
    ;; the approximation, so erf(0) ~ -3e-8 (MEASURED, well inside the 1.2e-7 bound); a golden rounds
    ;; it to 0, which is the exact mathematical value.
    (fn erf [x <- Real] -> Real
        (return (- 1.0 (erfc x))))

    ;; -- factorial / binomial for large arguments, via log-gamma -----------------------------------
    ;;
    ;; These take Real, not Int, and return Real, on purpose: the entire reason they exist is the
    ;; regime where the EXACT int64 `factorial`/`binomial` in `elementary` have given up -- n! overruns
    ;; int64 at n=21, C(n,k) not much later -- and the answer has to be a float because it no longer
    ;; fits an integer either. `elementary` owns the exact-integer domain; these own everything past it.
    ;;
    ;; log(n!) = logGamma(n+1). Finite for n into the billions (log(1e9!) ~ 1.9e10, a comfortable
    ;; double), where n! itself is +inf past n~170. This is the value you actually want for large n --
    ;; a log-probability, a log-partition function -- never the astronomically-overflowing n! directly.
    (fn lfactorial [n <- Real] -> Real
        (return (lgamma (+ n 1.0))))

    ;; n! as a float, = Gamma(n+1). Exact-integer-valued and recoverable by rounding for small n (the
    ;; example does), but OVERFLOWS to +inf past n~170 (170! ~ 7.3e306 fits, 171! does not) -- that is
    ;; trap 1 again, and the reason `lfactorial` is the one to reach for when n is large.
    (fn factorial-real [n <- Real] -> Real
        (return (gamma (+ n 1.0))))

    ;; log C(n,k) = logGamma(n+1) - logGamma(k+1) - logGamma(n-k+1). The headline of the log-domain
    ;; approach: C(100,50) ~ 1.0e29 is ten orders of magnitude past int64's 9.2e18 -- `elementary`'s
    ;; exact `binomial` returns its -1 overflow sentinel there -- yet log C(100,50) ~ 66.78 is a small,
    ;; well-conditioned number, and exp of it recovers the value to full relative accuracy.
    (fn lbinomial [n <- Real k <- Real] -> Real
        (return (- (- (lgamma (+ n 1.0)) (lgamma (+ k 1.0))) (lgamma (+ (- n k) 1.0)))))

    ;; C(n,k) as a float. Fits a double (< ~1.8e308) far past where it fits an int64, so this is the
    ;; usable binomial for large n; exponentiates the log form once. For n,k small enough that C(n,k)
    ;; is an exact integer under 2^53 it rounds back to that integer.
    (fn binomial-real [n <- Real k <- Real] -> Real
        (return (Math.exp (lbinomial n k))))

    (export
        gamma lgamma
        beta lbeta
        erf erfc
        lfactorial factorial-real
        lbinomial binomial-real)
)

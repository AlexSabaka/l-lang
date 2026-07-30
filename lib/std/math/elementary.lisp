;; std/math/elementary -- the everyday numeric layer: the floor gap, filled portably and typed.
;;
;; The floor (D50) already ships a libm surface as `Math.*` -- sqrt sin cos tan asin acos atan atan2
;; exp log pow abs floor ceil round trunc sign min max hypot. This module is NOT a second copy of
;; that. It exists for exactly the three places the raw floor is not enough for a library that
;; promises both backends agree byte-for-byte:
;;
;;   1. THE GAP. `log2 log10 cbrt log1p expm1` and the six hyperbolics `sinh cosh tanh asinh acosh
;;      atanh` are simply absent -- libm has them, the floor does not expose them. Built here once,
;;      as l-lang, so both backends run the SAME derivation rather than two libm entry points.
;;
;;   2. PORTABILITY HOLES in what IS exposed. `Math.min`/`Math.max` are the measured example: the C
;;      floor is `a < b ? a : b`, so `(Math.min nan 5)` is `NaN` on JS and `5` on C, and
;;      `(Math.min -0 0)` is `-0` on JS and `0` on C -- one source file, both backends, no
;;      diagnostic. A module that re-exported them would inherit a D50 violation. So `min`/`max` are
;;      reimplemented below with explicit `isNaN` guards, which ARE portable. (The floor divergence
;;      itself is a bug to fix in the C runtime; it is reported, not worked around silently -- the
;;      workaround here is only so this module's own `min`/`max` are honest.)
;;
;;   3. DOMAIN + CONDITIONING traps. `Math.hypot 4 6` is `…979` on node and `…978` on clang -- 1 ULP,
;;      because libm's `hypot` is a compound routine each platform rounds its own way; so `hypot`
;;      here is a SCALED kernel built only from `+ - * / sqrt`, every one of which IEEE-754 requires
;;      to be correctly rounded, hence byte-identical on both backends AND overflow-proof (the naive
;;      `sqrt(x*x+y*y)` overflows the moment |x| passes 1.3e154, where the answer is nowhere near
;;      overflow). `asin`/`acos` NaN on the tiny overshoot a dot-product/magnitude ratio produces
;;      (`acos 1.0000000002` is NaN, wanted 0). `expm1`/`log1p` lose almost all significance near 0:
;;      measured, naive `log(1+1e-12)` is 1.000088900581841e-12 -- nine wrong digits -- against the
;;      corrected 9.999999999995e-13.
;;
;; -----------------------------------------------------------------------------------------------
;; TWO ACCURACY CONTRACTS, and which functions fall under each.
;;
;; * BYTE-IDENTICAL across backends: everything built only from IEEE-754 correctly-rounded ops
;;   (`+ - * / sqrt`, comparisons) and from int64 arithmetic. That is all the integer helpers, the
;;   rounding family, clamp/lerp, the angle conversions, and hypot. These print the same string on
;;   both backends because the doubles are bit-for-bit equal.
;;
;; * LAST-ULP portable: anything that routes through `Math.log`/`Math.exp`/`Math.pow` (the logs,
;;   cbrt, and the hyperbolics) inherits libm's ~1 ULP cross-backend wobble -- measured
;;   `(atanh 0.5)` is …548 on JS, …549 on C. Correct to within a couple of ULP, but a golden over
;;   these MUST round to fixed digits, never pin full precision. This is stated per function below.
;;
;; -----------------------------------------------------------------------------------------------
;; INT64 WRAPS THE SAME ON BOTH BACKENDS. Measured: `21!` computed by naive multiply is
;; -4249290049419214848 on node AND on clang -- JS's BigInt Int is masked back to 64 bits, it does
;; not grow. So `factorial`/`binomial`/`lcm` overflow is not a divergence; it is a WRONG (wrapped)
;; answer that is wrong identically. The domain guards below (`-1` sentinel) exist for HONESTY --
;; refusing to hand back garbage -- not to rescue a backend disagreement that does not exist.
;;
;; Self-contained: imports nothing (its declared dependency set is empty), so it is safe to compile
;; while the rest of std/math is being moved. The public constants (PI, E, ...) belong to core; the
;; few needed here are file-local and unexported to avoid two owners for one name.
(
    ;; -- file-local constants -----------------------------------------------------------------------
    ;; The nearest double to each value. Unexported: `std/math/core` is the one place these are public,
    ;; and a second exporter is the exact duplicate-symbol hole D20's gate is being built to close.
    (let PI   3.141592653589793)
    (let TAU  6.283185307179586)
    (let LN2  0.6931471805599453)   ;; log 2,  for log2  -- a constant, not `(Math.log 2)`, so the
    (let LN10 2.302585092994046)    ;; log 10, for log10    result never depends on that call agreeing
    (let MAX_I64 9223372036854775807)  ;; 2^63 - 1, the overflow fence for the integer helpers

    ;; -- the everyday reals: sign, magnitude, extremes, blends -------------------------------------

    ;; `abs`/`sign` wrap the floor unchanged: both are portable already -- `(abs nan)`=NaN, `(abs -0)`
    ;; =0, `(sign -0)`=-0, `(sign nan)`=NaN, measured identical on both. `sign` is the three-way
    ;; -1/0/1 (and passes NaN and -0 through), NOT a Boolean.
    (fn abs [x <- Real] -> Real (Math.abs x))
    (fn sign [x <- Real] -> Real (Math.sign x))

    ;; `min`/`max` are l-lang, not `Math.min`/`Math.max`, for the reason in the header: the floor's
    ;; C arm disagrees with JS on NaN and on -0. The guards make NaN PROPAGATE (either operand
    ;; NaN -> NaN) identically on both, which is both the mathematically defensible reading and the
    ;; portable one. The -0-vs-0 tie is resolved by argument order and is deliberately not special
    ;; -cased -- nobody may depend on which zero `min` returns, only that both backends return it.
    ;;
    ;; THE NaN TEST IS `(!= x x)`, NOT `isNaN`, and that is a portability fix rather than a style
    ;; choice. `isNaN` is a FLOOR entry declared `[Any] -> Boolean`, and on JS it resolves to the HOST
    ;; `isNaN`, which is only handed `__ll_hostnum`-converted arguments when the declared parameter is
    ;; `Real`. An `Any` parameter is passed through raw -- so `(isNaN 5)` on an Int reached the host
    ;; with a BigInt and threw `TypeError: Cannot convert a BigInt value to a number`, while C
    ;; answered `false`. These functions declare `Real` parameters, but Int literals reach them
    ;; through the gradual boundary, and `(min 1 2)` is the ordinary way to call them.
    ;;
    ;; `(!= x x)` is true for NaN and false for everything else, on both backends, for Real AND Int --
    ;; measured. It needs no floor entry at all, which is what D50 means by "everything else is
    ;; l-lang written ON the floor and is therefore portable by construction". The `isNaN` boundary
    ;; defect is real and is recorded in docs/roadmap.md; it is no longer in anyone's way.
    (fn min [a <- Real b <- Real] -> Real
        (if (!= a a) (return a))
        (if (!= b b) (return b))
        (if (< a b) (return a))
        (return b))
    (fn max [a <- Real b <- Real] -> Real
        (if (!= a a) (return a))
        (if (!= b b) (return b))
        (if (> a b) (return a))
        (return b))

    ;; Constrain `x` to `[lo, hi]`. Assumes `lo <= hi`; a reversed range collapses to `lo`, which is
    ;; a caller error, not a case worth a branch. NaN passes through (both comparisons are false).
    (fn clamp [x <- Real lo <- Real hi <- Real] -> Real
        (if (< x lo) (return lo))
        (if (> x hi) (return hi))
        (return x))

    ;; Linear blend. The `a + (b-a)*t` form, chosen over `(1-t)*a + t*b`: this one is EXACT at t=0
    ;; (returns `a` to the bit) and monotonic in `t`, which is what interpolation code needs; its
    ;; cost is that t=1 can miss `b` by a ULP. The symmetric form is exact at both ends but overshoots
    ;; in between and is non-monotonic when `a` and `b` are close -- the worse trade for geometry.
    (fn lerp [a <- Real b <- Real t <- Real] -> Real (+ a (* (- b a) t)))

    ;; -- rounding, all returning Real (D51 amendment (b): the sole Real->Int door is `truncate`) ----

    ;; Straight floor pass-throughs -- portable as-is (NaN/inf/-0 all agree, measured). Typed and
    ;; named here so a program reads `(floor x)` from std/math rather than reaching into the `Math.`
    ;; extern, and so the everyday surface is greppable in one place.
    (fn floor [x <- Real] -> Real (Math.floor x))
    (fn ceil  [x <- Real] -> Real (Math.ceil x))

    ;; ROUND-HALF-TOWARD-+INFINITY. `(round 2.5)`=3, `(round -2.5)`=-2, `(round 0.5)`=1. This is JS's
    ;; `Math.round` rule, NOT C `round()`'s ties-away-from-zero (which would give -3 for -2.5); the C
    ;; floor emulates JS with `floor(x+0.5)` precisely so the two agree, and D51's tie-break cites the
    ;; same case. The choice is not arbitrary: matching the one backend that cannot be changed (the
    ;; browser) is what keeps `round` a single rule instead of a per-backend one.
    (fn round [x <- Real] -> Real (Math.round x))

    ;; Toward zero, as a Real -- distinct from the floor's `truncate`, which is the Real->Int NARROW.
    ;; `trunc` keeps the value in Real so it composes in Real arithmetic (`(- x (trunc x))` below);
    ;; `truncate` is for when you actually want an Int out. Built from floor/ceil rather than a cast
    ;; so it stays Real on both arms.
    (fn trunc [x <- Real] -> Real
        (if (>= x 0.0) (return (Math.floor x)))
        (return (Math.ceil x)))

    ;; Signed fractional part: `x = (trunc x) + (fract x)` holds EXACTLY (the subtraction is exact --
    ;; `trunc x` and `x` share a sign and differ by less than 1). So `(fract -3.7)` is -0.7, not the
    ;; GLSL `x - floor(x)` convention's +0.3. The signed reading is the one that inverts `trunc`.
    (fn fract [x <- Real] -> Real (- x (trunc x)))

    ;; -- angles -------------------------------------------------------------------------------------
    ;; `->` is the return-type arrow token and cannot appear in an identifier, so the natural spelling
    ;; `deg->rad` is a parse error; `-to-` is the portable spelling. `(* d (/ PI 180))` reproduces PI
    ;; exactly at d=180 (measured), which the reordered `(/ (* d PI) 180)` does not always.
    (fn deg-to-rad [d <- Real] -> Real (* d (/ PI 180.0)))
    (fn rad-to-deg [r <- Real] -> Real (* r (/ 180.0 PI)))

    ;; -- hypot: the scaled kernel, byte-identical and overflow-proof --------------------------------
    ;; Factor out the largest magnitude before squaring, so nothing squared exceeds 1 and the sum
    ;; cannot overflow -- `(hypot 1e200 1e200)` is 1.4142135623730951e200, where `sqrt(x*x+y*y)` is
    ;; +inf. `max`/`abs` here are THIS module's portable versions, and `+ * / sqrt` are IEEE-correctly
    ;; -rounded, so the whole thing is bit-for-bit equal on both backends (unlike libm's `Math.hypot`,
    ;; measured 1 ULP apart). Exact when the true result is exact: `(hypot 3 4)`=5.
    (fn hypot [x <- Real y <- Real] -> Real
        (let m (max (abs x) (abs y)))
        (if (== m 0.0) (return 0.0))
        (let rx (/ x m))
        (let ry (/ y m))
        (return (* m (Math.sqrt (+ (* rx rx) (* ry ry))))))

    ;; The 3D case, for a Vec3 magnitude -- same scaling, three terms. (The n-dimensional norm lives
    ;; with the vector type, which owns the flat `[Real]` it walks.)
    (fn hypot3 [x <- Real y <- Real z <- Real] -> Real
        (let m (max (abs x) (max (abs y) (abs z))))
        (if (== m 0.0) (return 0.0))
        (let rx (/ x m))
        (let ry (/ y m))
        (let rz (/ z m))
        (return (* m (Math.sqrt (+ (+ (* rx rx) (* ry ry)) (* rz rz))))))

    ;; -- domain-guarded inverse trig ----------------------------------------------------------------
    ;; The floor's `Math.asin`/`Math.acos` NaN outside [-1,1], and the input is routinely a hair
    ;; outside it: `acos(dot(a,b) / (|a||b|))` produces 1.0000000002 from rounding for parallel
    ;; vectors, and the raw call turns a 0-degree angle into NaN. Clamping the argument returns the
    ;; correct limit (`acos 1` = 0). `atan`/`atan2` need no guard (total on the reals) and stay the
    ;; raw floor call.
    (fn asin [x <- Real] -> Real (return (Math.asin (clamp x -1.0 1.0))))
    (fn acos [x <- Real] -> Real (return (Math.acos (clamp x -1.0 1.0))))

    ;; -- integer helpers, all int64 and byte-identical ---------------------------------------------

    ;; Parity via `%`, which is portable on Int (measured: `-7 % 3` is -1 on both). `(% n 2)` is 0 for
    ;; even n of either sign and +/-1 for odd, so the `== 0` test is sign-safe without an `abs`.
    (fn is-even [n <- Int] -> Boolean (return (== (% n 2) 0)))
    (fn is-odd  [n <- Int] -> Boolean (return (not (== (% n 2) 0))))

    ;; Euclid on magnitudes; result non-negative, `(gcd 0 0)` = 0. The result is bounded by
    ;; `max(|a|,|b|)`, so gcd itself never overflows -- it is the one integer helper with no fence.
    (fn gcd [a <- Int b <- Int] -> Int
        (mut x <- Int (if (< a 0) (- a) a))
        (mut y <- Int (if (< b 0) (- b) b))
        (while (!= y 0) (
            (let t (% x y))
            (x := y)
            (y := t)))
        (return x))

    ;; Least common multiple, non-negative. Divide before multiplying (`(a/g)*b`, not `a*b/g`) to
    ;; delay overflow, and FENCE the remaining multiply: a coprime pair whose product exceeds int64
    ;; returns -1 rather than a wrapped value. `(lcm x 0)` = 0 by convention.
    (fn lcm [a <- Int b <- Int] -> Int
        (if (== a 0) (return 0))
        (if (== b 0) (return 0))
        (let g (gcd a b))
        (let aa (if (< a 0) (- a) a))
        (let bb (if (< b 0) (- b) b))
        (let q (/ aa g))
        (if (> q (/ MAX_I64 bb)) (return -1))
        (return (* q bb)))

    ;; n!. Exact for 0..20; `21!` is 5.1e19, past int64's 9.2e18, so `n > 20` returns -1 rather than
    ;; the wrapped -4249290049419214848 (which both backends produce identically -- see the header;
    ;; the guard is honesty, not divergence-avoidance). Negative n is undefined -> -1. -1 is a safe
    ;; sentinel because a real factorial is always >= 1.
    (fn factorial [n <- Int] -> Int
        (if (< n 0) (return -1))
        (if (> n 20) (return -1))
        (mut f <- Int 1)
        (mut i <- Int 2)
        (while (<= i n) (
            (f := (* f i))
            (i := (+ i 1)))
        )
        (return f))

    ;; C(n,k), exact. The multiplicative build `r = r*(n-k+i)/i` keeps `r` an exact integer at every
    ;; step, but `r*(n-k+i)` OVERFLOWS mid-loop for results that themselves fit -- `C(62,31)` is
    ;; 4.6e17, yet its naive intermediate is ~2.9e19 and wraps. The gcd reduction below removes the
    ;; common factors of the numerator and `i` against the running `r` FIRST, so the value carried is
    ;; never larger than the final coefficient. Only a genuinely-oversized result trips the fence
    ;; (`C(67,33)` = -1). `k` outside [0,n] is 0.
    (fn binomial [n <- Int k <- Int] -> Int
        (if (< n 0) (return 0))
        (if (< k 0) (return 0))
        (if (> k n) (return 0))
        (mut kk <- Int k)
        (if (> kk (- n kk)) (kk := (- n kk)))   ;; symmetry: iterate the smaller side
        (mut r <- Int 1)
        (mut i <- Int 1)
        (while (<= i kk) (
            (let num (+ (- n kk) i))
            (let g1 (gcd r i))
            (let r1 (/ r g1))
            (let i1 (/ i g1))
            (let g2 (gcd num i1))
            (let num1 (/ num g2))
            (let i2 (/ i1 g2))       ;; provably 1 -- the divide documents that, and costs nothing
            (if (> r1 (/ MAX_I64 num1)) (return -1))
            (r := (/ (* r1 num1) i2))
            (i := (+ i 1)))
        )
        (return r))

    ;; base^exp for exp >= 0, by LINEAR repeated multiply -- deliberately not exponentiation-by-
    ;; squaring. An int64 result caps a non-trivial `exp` at 62 (2^63 overflows), so the log-time
    ;; version saves at most ~56 multiplies on a path that is never hot, and it would have to HALVE the
    ;; exponent with `(/ e 2)`. That halving is exactly the integer division the JS import pipeline
    ;; currently miscompiles to FLOATING division (measured: an imported `(/ n 2)` returns 3.5, not 3 --
    ;; reported separately), which silently wrecks the squaring loop when imported. Division-free is
    ;; both the simpler code here and the portable one today.
    ;;
    ;; Negative exp is out of the integer domain -- base^exp is fractional for |base| > 1, so it
    ;; returns 0 there, EXCEPT the two bases where it is not fractional: 1^exp = 1 and (-1)^exp = +/-1,
    ;; handled so those do not silently answer 0. A large result wraps int64 (identically on both
    ;; backends), so overflow is a wrong-but-consistent value, not a divergence; the caller owns range.
    (fn pow-int [base <- Int exp <- Int] -> Int
        (if (< exp 0) (
            (if (== base 1) (return 1))
            (if (== base -1) (
                (if (== (% exp 2) 0) (return 1))
                (return -1)))
            (return 0)))
        (mut result <- Int 1)
        (mut e <- Int exp)
        (while (> e 0) (
            (result := (* result base))
            (e := (- e 1)))
        )
        (return result))

    ;; -- the log/root gap ---------------------------------------------------------------------------
    ;; All last-ULP portable (they route through Math.log/Math.pow). `(log2 1024)` lands on exactly 10;
    ;; `(log10 1000)` is 2.9999999999999996, NOT 3 -- the natural-log-and-divide cannot be exact at
    ;; every power, and forcing it would cost a branch per call for a digit nobody reads. Round any
    ;; golden over these.
    (fn log2  [x <- Real] -> Real (/ (Math.log x) LN2))
    (fn log10 [x <- Real] -> Real (/ (Math.log x) LN10))

    ;; Real cube root, sign-preserving (`Math.pow` NaNs on a negative base, so fold the sign out).
    ;; `Math.pow(a, 1/3)` is only good to a few ULP because 1/3 is not representable; one Newton step
    ;; on f(y)=y^3-a recovers near-full accuracy -- measured `(cbrt 27)`=3 and `(cbrt -8)`=-2 exactly.
    (fn cbrt [x <- Real] -> Real
        (if (== x 0.0) (return x))
        (let s (if (< x 0.0) -1.0 1.0))
        (let a (abs x))
        (mut y (Math.pow a (/ 1.0 3.0)))
        (y := (- y (/ (- (* y (* y y)) a) (* 3.0 (* y y)))))
        (return (* s y)))

    ;; log(1+x) without the cancellation that wrecks the naive form near 0 (measured 9 wrong digits at
    ;; x=1e-12). Kahan's trick: when `1+x` rounds back to 1, x IS the answer; otherwise the factor
    ;; `log(u)/(u-1)` carries the rounding of `u=1+x` back into the result. Accurate to < 2 ULP, and
    ;; the conditioning fix the hyperbolics below depend on.
    (fn log1p [x <- Real] -> Real
        (let u (+ 1.0 x))
        (if (== u 1.0) (return x))
        (return (/ (* x (Math.log u)) (- u 1.0))))

    ;; exp(x)-1. The Kahan correction `(u-1)*x/log(u)` (with `u=exp(x)`) divides out `u`'s rounding and
    ;; is < 2 ULP near 0, where naive `exp(x)-1` cancels to noise -- but it is ONLY needed there, and
    ;; for large x it is actively wrong: its numerator `(u-1)*x` overflows to +inf while the true answer
    ;; is finite. Measured, the bare correction returned `expm1 708` = +inf (true ~3.02e307) and `expm1
    ;; 710` = NaN (`(inf*x)/log(inf)`), both wrong. Once x >= 1 the correction buys nothing anyway --
    ;; `u` is far enough from 1 that `u-1` has no cancellation, and `u-1` is byte-identical to the
    ;; correction across [1,707] (measured) -- so return `u-1` directly there. That one guard fixes the
    ;; whole large-x range at a stroke: finite for x < 709.78, and `u-1` = `inf-1` = +inf beyond, with
    ;; no NaN. The near-0 path (|x| < 1) is left exactly as the correction. `u==1` -> x (tiny x, the
    ;; correction IS x); `u-1==-1` -> -1 (x large negative, exp underflowed to 0).
    (fn expm1 [x <- Real] -> Real
        (let u (Math.exp x))
        (if (== u 1.0) (return x))
        (let y (- u 1.0))
        (if (== y -1.0) (return -1.0))
        (if (>= x 1.0) (return y))
        (return (/ (* y x) (Math.log u))))

    ;; -- hyperbolics --------------------------------------------------------------------------------
    ;; Last-ULP portable. Each avoids the catastrophic cancellation of the textbook exponential form
    ;; in the regime where it bites, and the overflow of it in the regime where THAT bites.

    ;; sinh: near 0, `(e^x - e^-x)/2` cancels to noise, so use the `expm1` identity
    ;; `sinh x = em(em+2) / (2(1+em))` with `em = expm1 x`; away from 0 the direct form is fine and
    ;; cheaper. `(sinh 0)` = 0 exactly; `(sinh 1)` = 1.1752011936438014.
    (fn sinh [x <- Real] -> Real
        (if (>= (abs x) 1.0)
            (return (/ (- (Math.exp x) (Math.exp (- x))) 2.0)))
        (let em (expm1 x))
        (return (/ (* em (+ em 2.0)) (* 2.0 (+ 1.0 em)))))

    ;; cosh: `(e^x + e^-x)/2` -- both terms positive, so no cancellation ever; the direct form is
    ;; already accurate. `(cosh 0)` = 1 exactly.
    (fn cosh [x <- Real] -> Real (return (/ (+ (Math.exp x) (Math.exp (- x))) 2.0)))

    ;; tanh via `expm1(-2|x|)`: `t = -em2/(2+em2)` equals `(1-e^{-2|x|})/(1+e^{-2|x|})` with no
    ;; cancellation and no overflow -- for large |x| the exponential underflows and the formula
    ;; saturates cleanly to +/-1 rather than dividing inf by inf. Odd, so the sign is reapplied last.
    (fn tanh [x <- Real] -> Real
        (let a (abs x))
        (let em2 (expm1 (* -2.0 a)))
        (let t (/ (- em2) (+ 2.0 em2)))
        (if (< x 0.0) (return (- t)))
        (return t))

    ;; asinh = log(x + sqrt(x^2+1)), total on the reals but naive in two regimes: `x^2` overflows for
    ;; large |x|, and `x + sqrt(...)` cancels for large NEGATIVE x. Odd, so fold to |x| and branch:
    ;; huge -> log(2a) as log(a)+LN2 (a^2 would overflow); mid -> a rationalised form with no
    ;; cancellation; small -> log1p for accuracy near 0. `(asinh 1)` = 0.8813735870195429.
    (fn asinh [x <- Real] -> Real
        (let s (if (< x 0.0) -1.0 1.0))
        (let a (abs x))
        (cond
            ((> a 100000000.0)
                (return (* s (+ (Math.log a) LN2))))
            ((> a 2.0)
                (return (* s (Math.log (+ (* 2.0 a) (/ 1.0 (+ a (Math.sqrt (+ (* a a) 1.0)))))))))
            (#t
                (return (* s (log1p (+ a (/ (* a a) (+ 1.0 (Math.sqrt (+ 1.0 (* a a))))))))))))

    ;; acosh = log(x + sqrt(x^2-1)), domain x >= 1. Below 1 is out of domain -> NaN (via 0/0, which
    ;; the C double path returns rather than trapping, measured). Near 1, `sqrt(x^2-1)` cancels, so
    ;; use `sqrt((x-1)(x+1))` through log1p; huge x -> log(2x); mid -> a rationalised form.
    ;; `(acosh 1)` = 0 exactly.
    (fn acosh [x <- Real] -> Real
        (if (< x 1.0) (return (/ 0.0 0.0)))
        (if (> x 100000000.0) (return (+ (Math.log x) LN2)))
        (if (> x 2.0) (return (Math.log (- (* 2.0 x) (/ 1.0 (+ x (Math.sqrt (- (* x x) 1.0))))))))
        (let t (- x 1.0))
        (return (log1p (+ t (Math.sqrt (+ (* 2.0 t) (* t t)))))))

    ;; atanh = 0.5*log((1+x)/(1-x)), domain |x| < 1. `0.5*log1p(2x/(1-x))` is accurate near 0 (-> x)
    ;; and lets the endpoints fall out naturally: `x=+/-1` divides by zero to +/-inf, which log1p
    ;; carries through. Outside [-1,1] is NaN. NOTE this is the one function whose golden showed a
    ;; cross-backend split: `(atanh 0.5)` is …548 on JS, …549 on C (libm's log, 1 ULP) -- round it.
    (fn atanh [x <- Real] -> Real
        (if (> (abs x) 1.0) (return (/ 0.0 0.0)))
        (return (* 0.5 (log1p (/ (* 2.0 x) (- 1.0 x))))))

    (export
        abs sign min max clamp lerp
        floor ceil round trunc fract
        deg-to-rad rad-to-deg
        hypot hypot3
        asin acos
        is-even is-odd gcd lcm factorial binomial pow-int
        log2 log10 cbrt log1p expm1
        sinh cosh tanh asinh acosh atanh)
)

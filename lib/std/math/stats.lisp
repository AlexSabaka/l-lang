;; std/math/stats -- descriptive statistics over a flat Real[], stable by construction.
;;
;; DEPENDS ON: elementary (for the portable `abs`/`min`/`max`/`clamp`). `Math.sqrt` and `truncate`
;; are floor names (D50), ambient on both backends, so they need no import. Nothing else is pulled
;; in -- the D57 self-containment rule for std/math means a stats routine never breaks because a
;; sibling moved.
;;
;; -----------------------------------------------------------------------------------------------
;; TWO NUMERICAL DECISIONS CARRY THIS MODULE, and both are the classic "the naive form is a wrong
;; answer, not a slow one".
;;
;;   1. SUMMATION IS NEUMAIER-COMPENSATED, not a bare `+=`. A running float sum loses the low bits of
;;      each addend once the accumulator outgrows it; the error grows as O(n * eps * max|partial|),
;;      so a long stream of small numbers drifts. Neumaier's variant of Kahan-Babuska carries the
;;      lost bits in a separate compensation word and folds them back at the end, dropping the error
;;      to O(eps) INDEPENDENT of n. It is chosen over plain Kahan because it also handles the term
;;      that is LARGER than the running sum (Kahan silently drops the accumulator's low bits in that
;;      case); the extra cost is one compare and one subtract per element. Every accumulator is built
;;      only from IEEE-754 `+ - ` on doubles, each correctly rounded, so `sum`/`mean` are
;;      BYTE-IDENTICAL on both backends -- the compensation buys accuracy without costing portability.
;;
;;   2. VARIANCE IS A CORRECTED TWO-PASS, never `E[x^2] - E[x]^2`. The one-pass "sum of squares minus
;;      square of sum" is the textbook catastrophe: for data far from zero, `E[x^2]` and `E[x]^2` are
;;      two huge nearly-equal numbers whose difference is the tiny variance, so subtraction cancels
;;      almost every significant digit and can even go NEGATIVE. Two-pass subtracts the mean FIRST --
;;      the squared deviations are small and well conditioned -- and then applies the Chan-Golub-
;;      LeVeque correction term `-(sum of deviations)^2 / n` (the sum of deviations is zero in exact
;;      arithmetic; the term removes the residual rounding of the computed mean). MEASURED downstream
;;      in examples/40-math/07_stats: on [1e8+4, 1e8+7, 1e8+13, 1e8+16] this returns population
;;      variance 22.5 exactly, where the one-pass form loses all four significant digits.
;;
;; -----------------------------------------------------------------------------------------------
;; ORDER STATISTICS SORT WITH A BOTTOM-UP MERGESORT, and that is forced, not chosen.
;;
;; The floor's `sort`/`sort-by` TRAP on the C backend, so median/percentile/quartiles/mode -- all of
;; which need the data ordered -- carry their own sort. Bottom-up (iterative) mergesort is picked over
;; the recursive top-down form for one measured reason: it never computes a midpoint `(lo+hi)/2`, and
;; integer division is BROKEN across the import boundary. MEASURED this session: an imported
;; `(/ 7 2)` returns 3.5 on JS (the module-inlining path emits it as FLOATING division) while C
;; returns 3, and `arr[3.5]` then throws RangeError on JS and prints on C -- a silent D50 violation
;; caused by one integer divide. Bottom-up merging advances by run WIDTHS that double (1, 2, 4, ...),
;; using only `+` and `*`, so no integer division ever runs. The single place a genuine integer halve
;; is unavoidable -- the middle index of an even-length median -- goes through `(truncate (/ x*1.0 2))`,
;; i.e. a REAL divide then a narrow, which MEASURED returns 3 on both backends. The sort is stable
;; (equal keys keep input order via the `<=` tie-break); stability is invisible on bare reals but is
;; the correct default and costs nothing.
;;
;; -----------------------------------------------------------------------------------------------
;; PERCENTILE CONVENTION: R-7 (linear interpolation between closest ranks). There are at least three
;; incompatible conventions and they disagree on every non-trivial dataset:
;;   * NEAREST-RANK (no interpolation): rank = ceil(p/100 * n), take that order statistic. Jumps in
;;     steps, never interpolates -- what a naive "the 90th percentile is the value below which 90% lie"
;;     description implies.
;;   * R-7 / "linear" (THIS module): h = (n-1) * p/100, interpolate between floor(h) and floor(h)+1.
;;     The default of NumPy `percentile`, Excel `PERCENTILE.INC`, and most spreadsheets. Endpoints map
;;     to min (p=0) and max (p=100).
;;   * R-6 / "Weibull" / Excel `PERCENTILE.EXC`: h = (n+1) * p/100, which pulls the quantiles further
;;     into the tails and is undefined for p below 1/(n+1) or above n/(n+1).
;; R-7 is chosen because it is the one a reader most likely means and the one `quartiles` must agree
;; with; its p=50 reduces EXACTLY to `median` (MEASURED consistent on both datasets in the example).
;;
;; -----------------------------------------------------------------------------------------------
;; DEGENERATE INPUTS RETURN NaN, NEVER TRAP. A trap is catchable on JS and FATAL on C, so an empty
;; array or an n<2 sample variance cannot be allowed to divide-by-zero into a trap. NaN is produced
;; the portable way -- `0.0/0.0`, a REAL divide (Int/0 is the fatal one) -- which both backends make
;; NaN. A caller tests the result with its own is-nan; propagating NaN is the honest answer for "no
;; mean of nothing" and stays uniform across the two backends.
(import "std/math/elementary")
(
    ;; NaN, the degenerate-case answer. `0.0/0.0` is the portable spelling (MEASURED NaN on both);
    ;; `truncate`/`Math.sqrt` are floor names and stay unqualified.
    (let NANR (/ 0.0 0.0))

    ;; Integer min, for clamping a run bound to the array end. `(if (< a b) a b)` is the whole body --
    ;; expression-oriented, no `/`, so import-safe. (`min` from elementary is Real-typed and NaN
    ;; -propagating; array bounds are Int, hence a separate one-liner.)
    (fn min-int [a <- Int b <- Int] -> Int (if (< a b) a b))

    ;; -- summation and mean ------------------------------------------------------------------------

    ;; Neumaier-compensated sum of the first `n` elements. `t = s + x` is the rounded partial; the
    ;; branch adds back whichever operand's low bits `t` dropped -- `s`'s when `x` dominates, `x`'s
    ;; when `s` does -- into the compensation `c`, folded in once at the end. All `+ - `, so exact-
    ;; ly reproducible on both backends. `abs` is elementary's portable one.
    (fn sum-n [xs <- Real[] n <- Int] -> Real
        (mut s <- Real 0.0)
        (mut c <- Real 0.0)
        (mut i <- Int 0)
        (while (< i n) (
            (let x xs[i])
            (let t (+ s x))
            (if (>= (abs s) (abs x))
                (c := (+ c (+ (- s t) x)))
                (c := (+ c (+ (- x t) s))))
            (s := t)
            (i := (+ i 1))))
        (return (+ s c)))

    ;; Mean of the first `n`. `(* 1.0 n)` lifts the count to Real so the divide is REAL division, not
    ;; the Int/Int form that miscompiles under import (see header). Caller guarantees n > 0.
    (fn mean-n [xs <- Real[] n <- Int] -> Real (return (/ (sum-n xs n) (* 1.0 n))))

    ;; Kahan-quality sum of the whole array.
    (fn sum [xs <- Real[]] -> Real (return (sum-n xs xs.length)))

    ;; Arithmetic mean. Empty -> NaN (no mean of nothing), the non-trapping way.
    (fn mean [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (return (mean-n xs n)))

    ;; -- extremes ----------------------------------------------------------------------------------
    ;; `min`/`max` are elementary's, which PROPAGATE NaN (either operand NaN -> NaN) identically on
    ;; both backends -- so a data set containing NaN yields NaN here rather than a backend-dependent
    ;; answer (the floor's raw `Math.min` disagrees on NaN across backends; elementary fixed that).
    (fn minimum [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (mut m <- Real xs[0])
        (mut i <- Int 1)
        (while (< i n) ((m := (min m xs[i])) (i := (+ i 1))))
        (return m))

    (fn maximum [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (mut m <- Real xs[0])
        (mut i <- Int 1)
        (while (< i n) ((m := (max m xs[i])) (i := (+ i 1))))
        (return m))

    ;; max - min. Two passes for clarity; the data sets this serves are not large enough for the
    ;; single-pass fusion to matter, and two obvious passes beat one clever loop here.
    (fn range [xs <- Real[]] -> Real (return (- (maximum xs) (minimum xs))))

    ;; -- variance / standard deviation (corrected two-pass; see header) ----------------------------

    ;; The corrected sum of squared deviations, `sum d^2 - (sum d)^2 / n`, for the first `n` elements.
    ;; The subtracted term is zero in exact arithmetic and removes the mean's rounding in practice.
    ;; This is the numerically stable core both variance forms divide.
    (fn corrected-ss [xs <- Real[] n <- Int] -> Real
        (let m (mean-n xs n))
        (mut s2 <- Real 0.0)
        (mut s1 <- Real 0.0)
        (mut i <- Int 0)
        (while (< i n) (
            (let d (- xs[i] m))
            (s2 := (+ s2 (* d d)))
            (s1 := (+ s1 d))
            (i := (+ i 1))))
        (return (- s2 (/ (* s1 s1) (* 1.0 n)))))

    ;; Population variance: divide the corrected SS by n. n=1 gives 0 (a single point has no spread),
    ;; which falls out correctly; empty -> NaN.
    (fn variance-pop [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (return (/ (corrected-ss xs n) (* 1.0 n))))

    ;; Sample (unbiased, Bessel-corrected) variance: divide by n-1. Fewer than two points has no
    ;; sample variance -> NaN, again without a divide-by-zero trap.
    (fn variance-sample [xs <- Real[]] -> Real
        (let n xs.length)
        (if (< n 2) (return NANR))
        (return (/ (corrected-ss xs n) (* 1.0 (- n 1)))))

    ;; Standard deviations are the sqrt of the matching variance. `Math.sqrt` is IEEE-754 correctly
    ;; rounded on both backends (unlike libm's log/exp/pow), so a stddev over an exactly-computed
    ;; variance is byte-identical across backends.
    (fn stddev-pop [xs <- Real[]] -> Real (return (Math.sqrt (variance-pop xs))))
    (fn stddev-sample [xs <- Real[]] -> Real (return (Math.sqrt (variance-sample xs))))

    ;; -- the internal sort -------------------------------------------------------------------------

    ;; A fresh, ascending, STABLE copy of `xs` by bottom-up mergesort. Private -- callers reach it
    ;; only through median/mode/percentile. Each pass builds a new array with `.push` (index-write
    ;; `arr[i] :=` is unused anywhere in std/math and unverified on C, so it is avoided) merging
    ;; adjacent runs of length `width`, `width` doubling until it covers the array. No `(lo+hi)/2` --
    ;; every index is `+`/`*`, dodging the imported-integer-division bug. Equal keys take the left run
    ;; first (`<=`), which is what makes it stable. NaN keys compare false in every branch and drift to
    ;; arbitrary positions -- order statistics of NaN-bearing data are undefined, but the sort will not
    ;; crash on them.
    (fn sorted-copy [xs <- Real[]] -> Real[]
        (let n xs.length)
        (mut cur <- Real[] [])
        (mut i <- Int 0)
        (while (< i n) ((cur.push xs[i]) (i := (+ i 1))))
        (mut width <- Int 1)
        (while (< width n) (
            (mut out <- Real[] [])
            (mut lo <- Int 0)
            (while (< lo n) (
                (let mid (min-int (+ lo width) n))
                (let hi (min-int (+ lo (* 2 width)) n))
                (mut il <- Int lo)
                (mut ir <- Int mid)
                ;; Merge the two runs [il,mid) and [ir,hi). Spelled as a nested `if`, not `cond`:
                ;; `cond` in a lowered library module hits an unimplemented `visitCondCase` on the JS
                ;; leaf path (it works at top level, and on C) -- a real backend gap, tracked
                ;; separately; nested `if` is the portable spelling and lowers identically.
                (while (or (< il mid) (< ir hi)) (
                    (if (>= il mid)
                        ((out.push cur[ir]) (ir := (+ ir 1)))
                        (if (>= ir hi)
                            ((out.push cur[il]) (il := (+ il 1)))
                            (if (<= cur[il] cur[ir])
                                ((out.push cur[il]) (il := (+ il 1)))
                                ((out.push cur[ir]) (ir := (+ ir 1))))))))
                (lo := hi)))
            (cur := out)
            (width := (* width 2))))
        (return cur))

    ;; -- median, mode ------------------------------------------------------------------------------

    ;; Middle value of the sorted data. Odd n: the single centre. Even n: the mean of the two centres.
    ;; `mid` is `n/2` computed as a REAL divide then narrowed -- the one integer halve the module needs,
    ;; spelled the import-safe way. Empty -> NaN.
    (fn median [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (let s (sorted-copy xs))
        (let mid (truncate (/ (* 1.0 n) 2.0)))
        (if (== (% n 2) 1)
            (return s[mid])
            (return (/ (+ s[(- mid 1)] s[mid]) 2.0))))

    ;; The most frequent value, ties broken toward the SMALLEST (first in sorted order). Scans runs of
    ;; equal keys in the sorted copy with EXACT `==` -- which is what mode means for the discrete or
    ;; repeated data mode is defined on. On continuous data every value tends to be unique and this
    ;; returns the minimum; that is a property of the mode, not a bug, and is why continuous data wants
    ;; a histogram instead. Empty -> NaN.
    (fn mode [xs <- Real[]] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (let s (sorted-copy xs))
        (mut best <- Real s[0])
        (mut best-cnt <- Int 1)
        (mut cur-val <- Real s[0])
        (mut cur-cnt <- Int 1)
        (mut i <- Int 1)
        (while (< i n) (
            (if (== s[i] cur-val)
                (cur-cnt := (+ cur-cnt 1))
                ((cur-val := s[i]) (cur-cnt := 1)))
            (if (> cur-cnt best-cnt) ((best-cnt := cur-cnt) (best := cur-val)))
            (i := (+ i 1))))
        (return best))

    ;; -- percentiles and quartiles (R-7; see header) -----------------------------------------------

    ;; The p-th percentile, p in [0,100], by R-7 linear interpolation. `h = (n-1)*p/100` is the real-
    ;; valued rank; the result blends the two order statistics bracketing it. `h` is CLAMPED to
    ;; [0, n-1] first so a p outside [0,100] returns the min/max rather than indexing out of bounds
    ;; (out-of-bounds is a fatal trap on C). `lo` = floor(h) via truncate (h >= 0 here); when h is a
    ;; whole rank the interpolation weight is 0 and `s[lo]` is returned exactly, which also keeps
    ;; `s[lo+1]` from being read at the top end. Empty -> NaN; a single point is that point.
    (fn percentile [xs <- Real[] p <- Real] -> Real
        (let n xs.length)
        (if (== n 0) (return NANR))
        (if (== n 1) (return xs[0]))
        (let s (sorted-copy xs))
        (let top (- (* 1.0 n) 1.0))
        (mut h <- Real (* top (/ p 100.0)))
        (if (< h 0.0) (h := 0.0))
        (if (> h top) (h := top))
        (let lo (truncate h))
        (let frac (- h (* 1.0 lo)))
        (if (== frac 0.0) (return s[lo]))
        (return (+ s[lo] (* frac (- s[(+ lo 1)] s[lo])))))

    ;; The three quartiles as one value. A struct rather than three calls so the sort runs once at the
    ;; call site's discretion and the trio is obviously the same convention.
    (defstruct Quartiles
        (let :ctor q1 <- Real)
        (let :ctor q2 <- Real)
        (let :ctor q3 <- Real))

    (fn quartiles [xs <- Real[]] -> Quartiles
        (return (Quartiles (percentile xs 25.0) (percentile xs 50.0) (percentile xs 75.0))))

    ;; Interquartile range, Q3 - Q1. `q` is bound to a `let` before its fields are read: MEASURED,
    ;; `((f x).field)` compiles to `f(x).field()` on JS (a TypeError) while C reads the field -- so a
    ;; method/constructor result is always landed in a binding first.
    (fn iqr [xs <- Real[]] -> Real
        (let q (quartiles xs))
        (return (- q.q3 q.q1)))

    ;; -- bivariate: covariance, correlation, regression --------------------------------------------

    ;; The three deviation cross-moments Sxx, Syy, Sxy over the first `n` paired points, each in the
    ;; same corrected two-pass form as `corrected-ss` (subtract the mean, then remove its residual
    ;; rounding with the `-(sum dev)^2/n` term). Private: covariance, pearson and linreg all divide or
    ;; ratio these, so computing them once keeps the three in exact agreement.
    (defstruct Moments
        (let :ctor sxx <- Real)
        (let :ctor syy <- Real)
        (let :ctor sxy <- Real))

    (fn cross-moments [xs <- Real[] ys <- Real[] n <- Int] -> Moments
        (let mx (mean-n xs n))
        (let my (mean-n ys n))
        (mut sxx <- Real 0.0)
        (mut syy <- Real 0.0)
        (mut sxy <- Real 0.0)
        (mut cx <- Real 0.0)
        (mut cy <- Real 0.0)
        (mut i <- Int 0)
        (while (< i n) (
            (let dx (- xs[i] mx))
            (let dy (- ys[i] my))
            (sxx := (+ sxx (* dx dx)))
            (syy := (+ syy (* dy dy)))
            (sxy := (+ sxy (* dx dy)))
            (cx := (+ cx dx))
            (cy := (+ cy dy))
            (i := (+ i 1))))
        (return (Moments
            (- sxx (/ (* cx cx) (* 1.0 n)))
            (- syy (/ (* cy cy) (* 1.0 n)))
            (- sxy (/ (* cx cy) (* 1.0 n))))))

    ;; A mismatched pair uses the common prefix (n = shorter length) rather than trapping -- the same
    ;; non-fatal choice vector.lisp makes for a dimension mismatch, since the type system cannot see a
    ;; Real[]'s length and a hard length check would have to trap (fatal on C).

    ;; Population covariance: Sxy / n. Fewer than one paired point -> NaN.
    (fn covariance-pop [xs <- Real[] ys <- Real[]] -> Real
        (let n (min-int xs.length ys.length))
        (if (== n 0) (return NANR))
        (let mm (cross-moments xs ys n))
        (return (/ mm.sxy (* 1.0 n))))

    ;; Sample covariance: Sxy / (n-1). Fewer than two -> NaN.
    (fn covariance-sample [xs <- Real[] ys <- Real[]] -> Real
        (let n (min-int xs.length ys.length))
        (if (< n 2) (return NANR))
        (let mm (cross-moments xs ys n))
        (return (/ mm.sxy (* 1.0 (- n 1)))))

    ;; Pearson product-moment correlation, r = Sxy / sqrt(Sxx * Syy). Computed from the deviation
    ;; moments (not from cov/std separately) so the n-vs-(n-1) divisor cancels exactly and never
    ;; enters. `r` is CLAMPED to [-1,1]: it lies there mathematically, and clamping absorbs the last-
    ;; ULP overshoot that a ratio of rounded sums can produce on perfectly (anti)correlated data.
    ;; Constant x or y (zero denominator) -> NaN: correlation with a flat series is undefined.
    (fn pearson [xs <- Real[] ys <- Real[]] -> Real
        (let n (min-int xs.length ys.length))
        (if (< n 2) (return NANR))
        (let mm (cross-moments xs ys n))
        (let denom (Math.sqrt (* mm.sxx mm.syy)))
        (if (== denom 0.0) (return NANR))
        (return (clamp (/ mm.sxy denom) -1.0 1.0)))

    ;; Ordinary-least-squares fit of y = intercept + slope*x. `slope = Sxy/Sxx`, `intercept` forces
    ;; the line through the centroid (mean x, mean y), and `r2 = Sxy^2 / (Sxx*Syy)` is the fraction of
    ;; y's variance the line explains -- equal to pearson^2, computed here from the same moments.
    ;; Degenerate (n<2, or vertical data with Sxx=0 that has no finite slope) -> all-NaN.
    (defstruct LinRegression
        (let :ctor slope <- Real)
        (let :ctor intercept <- Real)
        (let :ctor r2 <- Real))

    (fn linreg [xs <- Real[] ys <- Real[]] -> LinRegression
        (let n (min-int xs.length ys.length))
        (if (< n 2) (return (LinRegression NANR NANR NANR)))
        (let mm (cross-moments xs ys n))
        (if (== mm.sxx 0.0) (return (LinRegression NANR NANR NANR)))
        (let mx (mean-n xs n))
        (let my (mean-n ys n))
        (let slope (/ mm.sxy mm.sxx))
        (let intercept (- my (* slope mx)))
        (let r2 (/ (* mm.sxy mm.sxy) (* mm.sxx mm.syy)))
        (return (LinRegression slope intercept r2)))

    (export
        sum mean
        minimum maximum range
        variance-pop variance-sample stddev-pop stddev-sample
        median mode
        percentile Quartiles quartiles iqr
        covariance-pop covariance-sample
        pearson
        LinRegression linreg)
)

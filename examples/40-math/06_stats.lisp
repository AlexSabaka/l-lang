;; std/math/stats -- descriptive statistics and least-squares regression, on both backends.
;;
;; The dataset is the canonical teaching set [2 4 4 4 5 5 7 9]: mean 5, population variance exactly
;; 4 (deviations -3 -1 -1 -1 0 0 2 4, squares summing to 32, /8 = 4), so its standard deviation is
;; exactly 2. Every golden below is DERIVED from that, never pasted from a run:
;;   * var-sample = 32/7 = 4.571429, std-sample = sqrt(32/7) = 2.13809.
;;   * median 4.5 (mean of the two centres 4,5); mode 4 (three occurrences); iqr 5.5-4 = 1.5.
;;   * The "adv" block is the catastrophic-cancellation test: [1e8+4 1e8+7 1e8+13 1e8+16] has spread
;;     tiny against magnitude, so a naive sum-of-squares-minus-square-of-sum loses all precision.
;;     The two-pass corrected form here keeps it exact: deviations -6 -3 3 6, squares 90, var-pop
;;     90/4 = 22.5, var-sample 90/3 = 30, std-pop sqrt(22.5) = 4.743416.
;;   * Regression on xs=[1..5], ys=[1 3 2 5 4]: Sxy = 8, Sxx = Syy = 10, so slope 0.8, r2 = pearson^2
;;     = 0.64, and the line through the centroid (3,3) gives intercept 3 - 0.8*3 = 0.6 exactly. The
;;     perfect line ys=2x recovers slope 2, intercept 0, r = r2 = 1.
;;
;; The regression outputs are the one place two libms can split the last digit -- `intercept` comes
;; out 0.5999999999999996 on node and ...999 on clang, the same 0.6 wobbling in the 16th place -- so
;; slope/intercept/r2 round to 6 places (`r6`), where the wobble cannot reach and the printed value
;; is the mathematical one. Everything else is exact IEEE arithmetic and byte-identical on both.

(import "std/math/stats")

(
    ;; Round to 6 decimals. `Math.round` ties toward +Infinity on both backends (pinned by
    ;; 80-adversarial/numeric_floor_narrowing), so the rounded value is itself backend-independent.
    (fn r6 [x <- Real] -> Real (/ (Math.round (* x 1000000.0)) 1000000.0))

    (let a [2.0 4.0 4.0 4.0 5.0 5.0 7.0 9.0])
    (console.log "-- descriptive (dataset 2 4 4 4 5 5 7 9) --")
    (console.log "sum          =" (sum a))
    (console.log "mean         =" (mean a))
    (console.log "minimum      =" (minimum a))
    (console.log "maximum      =" (maximum a))
    (console.log "range        =" (range a))
    (console.log "median       =" (median a))
    (console.log "mode         =" (mode a))
    (console.log "var-pop      =" (variance-pop a))
    (console.log "var-sample   =" (r6 (variance-sample a)))
    (console.log "std-pop      =" (stddev-pop a))
    (console.log "std-sample   =" (r6 (stddev-sample a)))
    (console.log "p25          =" (percentile a 25.0))
    (console.log "p50          =" (percentile a 50.0))
    (console.log "p75          =" (percentile a 75.0))
    (let q (quartiles a))
    (console.log "q1 q2 q3     =" q.q1 q.q2 q.q3)
    (console.log "iqr          =" (iqr a))

    (console.log "-- variance survives catastrophic cancellation --")
    (let b [100000004.0 100000007.0 100000013.0 100000016.0])
    (console.log "adv var-pop  =" (variance-pop b))
    (console.log "adv var-samp =" (variance-sample b))
    (console.log "adv std-pop  =" (r6 (stddev-pop b)))

    (console.log "-- covariance / correlation / regression --")
    (let xs [1.0 2.0 3.0 4.0 5.0])
    (let ys [1.0 3.0 2.0 5.0 4.0])
    (console.log "cov-pop      =" (covariance-pop xs ys))
    (console.log "cov-sample   =" (covariance-sample xs ys))
    (console.log "pearson      =" (pearson xs ys))
    (let reg (linreg xs ys))
    (console.log "slope        =" (r6 reg.slope))
    (console.log "intercept    =" (r6 reg.intercept))
    (console.log "r2           =" (r6 reg.r2))

    (console.log "-- a perfect line ys = 2x --")
    (let ys2 [2.0 4.0 6.0 8.0 10.0])
    (let reg2 (linreg xs ys2))
    (console.log "perfect slope=" (r6 reg2.slope))
    (console.log "perfect int  =" (r6 reg2.intercept))
    (console.log "perfect r2   =" (r6 reg2.r2))
    (console.log "perfect r    =" (pearson xs ys2))

    (console.log "-- degenerate inputs return NaN / clamp, never trap --")
    (console.log "empty mean   =" (mean []))
    (console.log "single var-s =" (variance-sample [5.0]))
    (console.log "p110 clamp   =" (percentile a 110.0))
    (console.log "p-10 clamp   =" (percentile a -10.0))
)

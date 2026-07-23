;; std/math/elementary -- the everyday numeric layer, exercised on both backends.
;;
;; The module fills the floor's gaps (log2 log10 cbrt log1p expm1 and the six hyperbolics, none of
;; which the D50 `Math.*` surface exposes) and gives a portable, typed spelling of the everyday
;; reals and the integer helpers.
;;
;; TWO KINDS OF GOLDEN below, and the split is not cosmetic. Anything built only from IEEE-754
;; correctly-rounded ops -- the integer helpers, hypot, the rounding family, clamp/lerp -- is
;; BIT-IDENTICAL across backends, so its expected value is pinned exactly and derived from the
;; mathematics (a 3-4-5 triangle's hypotenuse is 5, full stop). Anything routed through libm
;; (`Math.log`/`exp`/`pow`: the logs, cbrt, the hyperbolics) carries a last-ULP wobble that differs
;; between node and clang -- measured, `(atanh 0.5)` is …548 on one and …549 on the other -- so those
;; are ROUNDED to 6 places, where the wobble cannot reach, and the 6-place value is the mathematical
;; one. Never pin a raw transcendental across two libms.
;;
;; Integer results are kept below 2^53 on purpose: the JS import path currently downgrades an Int to
;; a double when a module is imported (a compiler bug, reported separately), so an imported Int above
;; 2^53 would lose precision on one backend only. Everything here stays in the range where both
;; backends agree.

(import "std/math/elementary")

(
    ;; Round to 6 decimals so libm's last-ULP disagreement between the two backends cannot split the
    ;; golden. Uses the module's own `round` (ties toward +Infinity).
    (fn r6 [x <- Real] -> Real (/ (round (* x 1000000.0)) 1000000.0))

    ;; -- hypot: overflow-proof magnitude (the whole reason it is not sqrt(x*x+y*y)) ----------------
    (console.log "-- hypot --")
    (console.log "hypot 3 4      =" (hypot 3.0 4.0))            ;; 3-4-5
    (console.log "hypot 8 15     =" (hypot 8.0 15.0))           ;; 8-15-17
    (console.log "hypot3 2 3 6   =" (hypot3 2.0 3.0 6.0))       ;; 2^2+3^2+6^2 = 49
    (console.log "hypot 1e200    =" (hypot 1.0e200 1.0e200))    ;; = 1e200*sqrt2; naive squaring is +inf

    ;; -- rounding, and the tie-break rule ----------------------------------------------------------
    (console.log "-- rounding --")
    (console.log "round 2.5      =" (round 2.5))     ;; ties go toward +Infinity ...
    (console.log "round -2.5     =" (round -2.5))    ;; ... so -2.5 -> -2, NOT C round()'s -3
    (console.log "round 3.5      =" (round 3.5))
    (console.log "floor 3.7      =" (floor 3.7))
    (console.log "ceil 3.2       =" (ceil 3.2))
    (console.log "trunc -3.9     =" (trunc -3.9))    ;; toward zero
    (console.log "fract 3.25     =" (fract 3.25))    ;; signed: x - trunc(x)
    (console.log "fract -3.25    =" (fract -3.25))

    ;; -- clamp, lerp, angles -----------------------------------------------------------------------
    (console.log "-- clamp / lerp / angle --")
    (console.log "clamp 12 0 10  =" (clamp 12.0 0.0 10.0))
    (console.log "clamp -3 0 10  =" (clamp -3.0 0.0 10.0))
    (console.log "lerp 10 20 .5  =" (lerp 10.0 20.0 0.5))
    (console.log "lerp 0 100 .25 =" (lerp 0.0 100.0 0.25))
    (console.log "deg-to-rad 180 =" (deg-to-rad 180.0))              ;; exactly PI
    (console.log "rad-to-deg PI  =" (r6 (rad-to-deg 3.141592653589793)))

    ;; -- guarded inverse trig: clamping turns a roundoff NaN into the right limit -------------------
    (console.log "-- guarded asin / acos --")
    (console.log "asin 0.5       =" (r6 (asin 0.5)))       ;; PI/6
    (console.log "acos 1.000002  =" (acos 1.000002))       ;; clamps to 1 -> 0; raw Math.acos is NaN
    (console.log "asin 1.5       =" (r6 (asin 1.5)))       ;; clamps to 1 -> PI/2

    ;; -- the log / root gap ------------------------------------------------------------------------
    (console.log "-- log gap --")
    (console.log "log2 1024      =" (log2 1024.0))         ;; 2^10, lands exactly on 10
    (console.log "log2 8         =" (r6 (log2 8.0)))
    (console.log "log10 1000     =" (r6 (log10 1000.0)))
    (console.log "cbrt 27        =" (cbrt 27.0))           ;; Newton step recovers the exact 3
    (console.log "cbrt -8        =" (cbrt -8.0))
    (console.log "log1p e-1      =" (r6 (log1p 1.718281828459045)))  ;; log(e) = 1
    (console.log "expm1 1        =" (r6 (expm1 1.0)))                ;; e - 1

    ;; -- hyperbolics -------------------------------------------------------------------------------
    (console.log "-- hyperbolics --")
    (console.log "sinh 0         =" (sinh 0.0))
    (console.log "cosh 0         =" (cosh 0.0))
    (console.log "sinh 1         =" (r6 (sinh 1.0)))       ;; (e - 1/e)/2
    (console.log "cosh 1         =" (r6 (cosh 1.0)))       ;; (e + 1/e)/2
    (console.log "tanh 1         =" (r6 (tanh 1.0)))
    (console.log "asinh 1        =" (r6 (asinh 1.0)))      ;; ln(1 + sqrt2)
    (console.log "acosh 2        =" (r6 (acosh 2.0)))      ;; ln(2 + sqrt3)
    (console.log "atanh 0.5      =" (r6 (atanh 0.5)))      ;; ln(3)/2
    (console.log "acosh 0.5      =" (acosh 0.5))           ;; below domain -> NaN
    (console.log "atanh 2        =" (atanh 2.0))           ;; outside domain -> NaN

    ;; -- integer helpers (results < 2^53, so both backends agree) -----------------------------------
    (console.log "-- integers --")
    (console.log "gcd 1071 462   =" (gcd 1071 462))        ;; Euclid: 21
    (console.log "gcd 17 5       =" (gcd 17 5))            ;; coprime
    (console.log "lcm 21 6       =" (lcm 21 6))
    (console.log "factorial 5    =" (factorial 5))
    (console.log "factorial 10   =" (factorial 10))
    (console.log "factorial 21   =" (factorial 21))        ;; past int64 -> -1 sentinel
    (console.log "binomial 52 5  =" (binomial 52 5))       ;; poker hands
    (console.log "binomial 20 10 =" (binomial 20 10))
    (console.log "is-even 10     =" (is-even 10))
    (console.log "is-odd 7       =" (is-odd 7))
    (console.log "pow-int 2 10   =" (pow-int 2 10))
    (console.log "pow-int 3 4    =" (pow-int 3 4))
    (console.log "pow-int -2 3   =" (pow-int -2 3))
)

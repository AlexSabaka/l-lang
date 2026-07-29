;; std/math/complex -- the complex field on both backends, byte for byte.
;;
;; Every line below is a value a reader can check against mathematics: |3+4i| is 5 because 3-4-5 is a
;; right triangle, exp(i*pi) is -1 because Euler says so, (1+i)^8 is 16 because (1+i)^2 is 2i and 2i to
;; the fourth is 16. The golden is DERIVED from those facts, never pasted from a run -- which is the
;; only way a golden stays a test rather than a photograph of whatever the code happened to print.
;;
;; The two showcase lines are the last section: a division and a magnitude at 1e200, where the naive
;; textbook formulas overflow to NaN/Inf and this module's Smith division and hypot magnitude do not.
;; That is the entire reason the module is more than four one-line operators.
;;
;; Numbers print through the module's own `real-fixed` at a FIXED number of decimals. Raw float
;; printing would surface the last-ulp disagreement between node's libm and clang's on the
;; transcendental results (sin, cos, exp), and the golden would then be unwritable; four to six
;; decimals is coarse enough that the disagreement never reaches the printed digit.
(
    (import "std/math/complex")

    ;; Scalar -> fixed-decimal string, straight through the module's exported formatter.
    (fn sc [x <- Real d <- Int] -> String (return (real-fixed x d)))

    (fn main [] -> Void
        (let z (Complex 3.0 4.0))
        (let w (Complex 1.0 -2.0))

        (console.log "-- construction --")
        (console.log f"z            = {(z.show 4)}")
        (console.log f"w            = {(w.show 4)}")
        ;; polar(2, pi/3): 2cos60 = 1, 2sin60 = sqrt(3) = 1.732051
        (let p (polar 2.0 1.0471975511965976))
        (console.log f"polar(2,60d) = {(p.show 6)}")

        (console.log "-- parts --")
        (console.log f"re, im       = {(sc (z.real) 4)} {(sc (z.imag) 4)}")
        (console.log f"abs |z|      = {(sc (z.abs) 4)}")
        (console.log f"abs2 |z|^2   = {(sc (z.abs2) 4)}")
        (let onei (Complex 1.0 1.0))
        (console.log f"arg(1+i)     = {(sc (onei.arg) 6)}")

        (console.log "-- operators --")
        (let s (+ z w))
        (let d (- z w))
        (let m (* z w))
        (let q (/ z w))
        (let ng (- z))
        (console.log f"z + w        = {(s.show 4)}")   ;; 4+2i
        (console.log f"z - w        = {(d.show 4)}")   ;; 2+6i
        (console.log f"z * w        = {(m.show 4)}")   ;; 11-2i
        (console.log f"z / w        = {(q.show 4)}")   ;; -1+2i
        (console.log f"-z           = {(ng.show 4)}")  ;; -3-4i

        (console.log "-- elementary --")
        (let eipi (polar 1.0 3.141592653589793))       ;; exp(i*pi) = -1
        (console.log f"exp(i*pi)    = {(eipi.show 6)}")
        (let li (I.log))                                ;; log(i) = i*pi/2
        (console.log f"log(i)       = {(li.show 6)}")
        (let r1 (z.sqrt))                               ;; sqrt(3+4i) = 2+i
        (console.log f"sqrt(3+4i)   = {(r1.show 4)}")
        (let nfour (Complex -4.0 0.0))
        (let r2 (nfour.sqrt))                           ;; sqrt(-4) = 2i
        (console.log f"sqrt(-4)     = {(r2.show 4)}")
        (let e8 (onei.powi 8))                          ;; (1+i)^8 = 16
        (console.log f"(1+i)^8      = {(e8.show 4)}")
        (let two (Complex 2.0 0.0))
        (let twoi (two.pow I))                          ;; 2^i = cos(ln2)+i sin(ln2)
        (console.log f"2^i          = {(twoi.show 6)}")

        (console.log "-- trig --")
        (let si (I.sin))                                ;; sin(i) = i*sinh(1)
        (console.log f"sin(i)       = {(si.show 6)}")
        (let ci (I.cos))                                ;; cos(i) = cosh(1)
        (console.log f"cos(i)       = {(ci.show 6)}")
        (let qpi (Complex 0.7853981633974483 0.0))
        (let tq (qpi.tan))                              ;; tan(pi/4) = 1
        (console.log f"tan(pi/4)    = {(tq.show 6)}")

        (console.log "-- equality --")
        (let zc (Complex 3.0 4.0))
        (let zl (Complex 3.0005 4.0))
        (let zf (Complex 3.02 4.0))
        (console.log f"eq exact     = {(z.eq zc)}")
        (console.log f"near 5e-4    = {(z.near zl 0.001)}")
        (console.log f"near 2e-2    = {(z.near zf 0.001)}")

        (console.log "-- glyphs --")
        (let cg (z.†))
        (console.log f"norm  glyph  = {(sc (z.‖) 4)}")   ;; |z| via the ‖ delegate
        (console.log f"arg   glyph  = {(sc (I.∠) 6)}")   ;; arg(i) via the angle delegate
        (console.log f"conj  glyph  = {(cg.show 4)}")    ;; conj via the dagger delegate
        (console.log f"near  glyph  = {(z.≈ zc)}")       ;; tolerant equality via the almost-equal delegate

        (console.log "-- overflow safety --")
        ;; Smith division and the hypot magnitude at 1e200: the naive (ac+bd)/(cc+dd) and
        ;; sqrt(re^2+im^2) both overflow here (cc+dd = 1e400 = Inf), these do not.
        (let big (Complex 3.0e200 4.0e200))
        (let unit (Complex 1.0e200 0.0))
        (let bq (/ big unit))                           ;; 3+4i
        (console.log f"smith 1e200  = {(bq.show 4)}")
        (let bm (big.abs))                              ;; 5e200; print /1e200 = 5
        (console.log f"hypot 1e200  = {(sc (/ bm 1.0e200) 4)}"))

    (main)
)

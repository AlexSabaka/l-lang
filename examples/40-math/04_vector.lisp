;; std/math/vector -- the same algebra in 2D, 3D, and n dimensions.
;;
;; The point of the module is that `+ - * /` mean on a vector what they mean on a number, and
;; everything that LEAVES the vector world -- dot (-> Real), cross, length, angle -- is a named method,
;; not an operator that would have to lie about its return type. This file exercises that surface on
;; both backends; its golden is derived from mathematics, never pasted from a run.
(
    (import "std/math")

    ;; -- deterministic rendering ------------------------------------------------------------------
    ;; Every number is printed through `fixed`, which rounds to a set number of decimals and pads.
    ;; Raw float printing would expose the last-ULP disagreement between node's libm and clang's on the
    ;; transcendental results (angle-between is `acos`), and the golden would then be unwritable. Four
    ;; decimals is coarse enough that the disagreement never reaches the printed digit.
    (fn ipow10 [d <- Int] -> Int
        (mut r <- Int 1) (mut i <- Int 0)
        (while (< i d) ((r := (* r 10)) (i := (+ i 1)))) (return r))

    (fn fixed [x <- Real d <- Int] -> String (
        (mut neg <- Boolean #f) (mut v <- Real x)
        (if (< v 0.0) ((neg := #t) (v := (- 0.0 v))))
        (let scale (ipow10 d))
        (let scaled (Math.trunc (Math.round (* v scale))))
        (let ipart (/ scaled scale))
        (let fpart (- scaled (* ipart scale)))
        (mut frac <- String "") (mut p (/ scale 10)) (mut rem fpart)
        (while (> p 0) (
            (let digit (/ rem p)) (frac := '"{frac}{digit}")
            (rem := (- rem (* digit p))) (p := (/ p 10))))
        (mut sign <- String "") (if (and neg (> scaled 0)) (sign := "-"))
        (return '"{sign}{ipart}.{frac}")))

    (fn f2 [v <- Vec2] -> String (return '"({(fixed v.x 4)}, {(fixed v.y 4)})"))
    (fn f3 [v <- Vec3] -> String (return '"({(fixed v.x 4)}, {(fixed v.y 4)}, {(fixed v.z 4)})"))
    (fn fnv [v <- Vec] -> String (
        (mut s <- String "(") (mut i <- Int 0) (let n (v.size))
        (while (< i n) (
            (if (> i 0) (s := '"{s}, "))
            (s := '"{s}{(fixed (v.at i) 4)}")
            (i := (+ i 1))))
        (return '"{s})")))

    ;; -- Vec3: the 3D algebra ---------------------------------------------------------------------
    (console.log "-- Vec3 --")
    (let v (Vec3 3.0 4.0 0.0))
    (let w (Vec3 1.0 2.0 2.0))
    (console.log '"v+w        {(f3 (+ v w))}")          ;; (4, 6, 2)
    (console.log '"v-w        {(f3 (- v w))}")          ;; (2, 2, -2)
    (console.log '"-v         {(f3 (- v))}")            ;; (-3, -4, 0)
    (console.log '"v*2        {(f3 (* v 2.0))}")        ;; scalar on the RIGHT
    (console.log '"v.scale 2  {(f3 (v.scale 2.0))}")    ;; the scalar-on-the-LEFT spelling
    (console.log '"dot v w    {(fixed (v.dot w) 4)}")   ;; 3*1+4*2+0*2 = 11
    (console.log '"cross v w  {(f3 (v.cross w))}")      ;; (4*2-0*2, 0*1-3*2, 3*2-4*1) = (8,-6,2)
    (console.log '"len v      {(fixed (v.length) 4)}")  ;; sqrt(9+16) = 5
    (console.log '"len-sq v   {(fixed (v.length-sq) 4)}") ;; 25
    (console.log '"norm w     {(f3 (w.normalise))}")    ;; (1,2,2)/3
    (console.log '"dist v w   {(fixed (v.distance w) 4)}") ;; |(2,2,-2)| = sqrt(12)
    (console.log '"angle v w  {(fixed (v.angle-between w) 4)}") ;; acos(11/15)
    (console.log '"lerp .5    {(f3 (v.lerp w 0.5))}")   ;; midpoint (2, 3, 1)
    (console.log '"reflect    {(f3 ((Vec3 1.0 -1.0 0.0).reflect (Vec3 0.0 1.0 0.0)))}") ;; bounce off floor
    (console.log '"project    {(f3 ((Vec3 2.0 3.0 5.0).project (Vec3 1.0 0.0 0.0)))}") ;; onto x-axis

    ;; -- Vec2: the two operations that only make sense in the plane --------------------------------
    (console.log "-- Vec2 --")
    (let a (Vec2 3.0 4.0))
    (let b (Vec2 1.0 2.0))
    (console.log '"perp-dot   {(fixed (a.perp-dot b) 4)}") ;; ax*by-ay*bx = 2 -- a SCALAR (signed area)
    (console.log '"perp a     {(f2 (a.perp))}")            ;; rotate +90 deg: (-4, 3)
    (console.log '"norm a     {(f2 (a.normalise))}")       ;; (3,4)/5 = (0.6, 0.8)

    ;; -- Vec: the general n-dimensional case ------------------------------------------------------
    (console.log "-- Vec --")
    (let p (Vec [1.0 2.0 2.0]))
    (let q (Vec [4.0 4.0 2.0]))
    (console.log '"p+q        {(fnv (+ p q))}")         ;; (5, 6, 4)
    (console.log '"dot p q    {(fixed (p.dot q) 4)}")   ;; 4+8+4 = 16
    (console.log '"len p      {(fixed (p.length) 4)}")  ;; sqrt(1+4+4) = 3
    (console.log '"norm p     {(fnv (p.normalise))}")   ;; (1,2,2)/3
    (console.log '"to-string  {(p.to-string)}")         ;; the module's own raw renderer
    ;; A dimension mismatch clamps to the smaller dimension rather than trapping (fatal on C).
    (console.log '"mismatch   {(fnv (+ (Vec [1.0 2.0 3.0]) (Vec [10.0 10.0])))}") ;; (11, 12)

    ;; -- the optional glyph synonyms are their ASCII twins, exactly -------------------------------
    (console.log "-- glyphs --")
    (console.log '"dot   {(fixed (v.dot w) 4)} == {(fixed (v.⋅ w) 4)}")
    (console.log '"cross {(f3 (v.cross w))} == {(f3 (v.⨯ w))}")
    (console.log '"norm  {(fixed (v.length) 4)} == {(fixed (v.‖) 4)}")
    (console.log '"perp  {(f2 (a.perp))} == {(f2 (a.⊥))}")

    ;; -- zero-length and equality -----------------------------------------------------------------
    (console.log "-- edge cases --")
    (console.log '"norm 0     {(f3 ((Vec3 0.0 0.0 0.0).normalise))}") ;; no direction -> zero, not NaN
    (console.log '"eq  v v    {(v.eq v)}")                            ;; true
    (console.log '"eq  v w    {(v.eq w)}")                            ;; false
    (console.log '"near tol   {(v.near (Vec3 3.0 4.0 0.0009) 0.001)}") ;; within 0.001 -> true
)

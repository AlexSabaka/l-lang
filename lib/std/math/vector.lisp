;; std/math/vector -- Euclidean vectors: Vec2 and Vec3 as concrete value types, Vec for the n-dim case.
;;
;; THREE TYPES, NOT ONE, AND THAT IS THE DESIGN.
;;
;; Games and geometry are almost never n-dimensional -- they are 2D and 3D, over and over -- and a
;; fixed-size type is the right tool for a fixed-size problem: its fields are named `x y z` rather than
;; indexed, its arithmetic unrolls to three named multiplies with no loop and no bounds check, and its
;; dimension is in the TYPE, so `Vec2 + Vec3` is a compile error instead of a silent truncation. `Vec`
;; over a flat `Real[]` exists for the genuinely general case (an embedding, a state vector), and it
;; pays for that generality: a heap array, a loop, and -- see below -- a dimension the type system
;; cannot check.
;;
;; -----------------------------------------------------------------------------------------------
;; THE OPERATOR RULING (D57), APPLIED EXACTLY.
;;
;; The admitted operators are `+ - * /` and unary `-`, declared in METHOD form so `this` is the LEFT
;; operand. `+ -` are vector-on-vector; `* /` are the SCALAR-ON-THE-RIGHT scale, `(* v k)` / `(/ v k)`.
;; Everything else -- dot, cross, length, angle -- is an ASCII NAME, because it is not a field
;; operation: `(dot a b) : Vec3 -> Vec3 -> Real` LEAVES the type, so it could never be `*` without `*`
;; lying about what it returns.
;;
;; The one place the ruling meets a wall in this language is SCALAR-ON-THE-LEFT. `(* k v)` is measured
;; dead -- `nil` on JS, ELL0106 on C -- because C's `mkBinop` dispatches off the left operand's static
;; type and a bare `Real` on the left carries no vector method. The ruling's remedy is a free function
;; `(scale k v)`; that remedy does not survive contact with this compiler, because FREE-FUNCTION
;; OVERLOADING DOES NOT EXIST here (MEASURED: a second `(fn scale [k v <- Vec3])` shadows the first, and
;; `(scale k aVec2)` then fails ELL0203 "expected Vec3, got Vec2"). One `scale` cannot cover three
;; types. So the scalar-multiply spelling is the METHOD `(v.scale k)` -- it dispatches on the receiver,
;; reads as "v scaled by k", and is uniform across all three types. `(* v k)` is its operator twin.
;; `(* k v)` remains unavailable by the ruling; reach for `(v.scale k)`.
;;
;; -----------------------------------------------------------------------------------------------
;; DECISIONS A VECTOR LIBRARY HAS TO MAKE, AND WHAT WENT WRONG WITH THE ALTERNATIVE.
;;
;; * `length` uses a SCALED sum-of-squares, not the naive `sqrt(x*x+...)`. Naive squaring overflows to
;;   +Inf once a component passes ~1.3e154 (its square passes 1.8e308), and the vector's length is then
;;   Inf even though it is perfectly representable. Scaling by the largest component first pushes that
;;   cliff out past 1e308. The cost is one divide per component and about 1 ulp of rounding; the naive
;;   form is only "exact" until it is catastrophically wrong.
;;
;; * `length-sq` is public on purpose. Comparing two magnitudes, or testing a radius, never needs the
;;   sqrt -- `(< (a.length-sq) (b.length-sq))` is the same order as the lengths, is one multiply-add
;;   cheaper per component, and stays EXACT on integer-valued inputs where `length` would not.
;;
;; * `normalise` on a ZERO vector returns the ZERO vector. A zero vector has no direction, so there is
;;   no unit answer; the alternatives are to divide by zero (NaN in every component, which then spreads
;;   through whatever consumes the result) or to trap (fatal on the C backend). Returning zero is the
;;   one choice a caller can test for with `(v.length-sq)` and recover from. Documented, not discovered.
;;
;; * There is no 3D `cross` on `Vec2` -- the cross product is defined in 3D, and a 2D "cross" is really
;;   the z-component of the 3D cross of the embedded vectors, a SCALAR. It is named `perp-dot` precisely
;;   so it does not read like a vector: `(a.perp-dot b)` is `ax*by - ay*bx`, the signed area of the
;;   parallelogram, positive when b is counter-clockwise from a. The vector-valued 2D operation is
;;   `perp` -- a 90-degree rotation, `(x,y) -> (-y,x)`.
;;
;; * `angle-between` is `acos` of the clamped cosine, and the cosine is taken from the two UNIT vectors
;;   -- `(normalise a) . (normalise b)`, NOT the naive `dot/(|a||b|)`. The naive quotient overflows the
;;   moment `dot` or `|a||b|` does: MEASURED, two PARALLEL vectors with 1e200 components (or 1e-200) came
;;   back NaN instead of 0, because Inf/Inf and 0/0 are NaN -- and that threw away the overflow-safe
;;   `length` above one line after computing it. Normalising first bounds every component to [-1,1], so
;;   the dot cannot overflow, and equals the quotient to the ULP at normal scale. The clamp still matters:
;;   even the unit-vector dot can land a hair outside [-1,1] by rounding, and `acos(1.0000000002)` is NaN.
;;   angle-between still inherits acos's imprecision -- MEASURED `(Math.acos 0.5)` is ...979 on node and
;;   ...976 on clang, a last-ULP split -- so a caller that needs a stable value across backends must ROUND
;;   the angle. Every other operation here uses only +,-,*,/ and sqrt, all IEEE-correctly-rounded, and is
;;   therefore byte-identical on both backends.
;;
;; * `Vec` (n-dim) arithmetic over MISMATCHED dimensions clamps to the smaller dimension instead of
;;   trapping. The type system cannot see the length of a `Real[]`, so a dimension mismatch is a runtime
;;   condition, and a runtime out-of-bounds is catchable on JS but FATAL on C -- the one thing a library
;;   must never do. Operating over the common prefix is a defined, total answer; mismatched dimensions
;;   are a caller error, and this is the non-lethal way to survive one.
(
    ;; -- internal scalar helpers (not exported; the module's own plumbing) ------------------------
    ;;
    ;; `absr`/`mini` rather than `abs`/`min`: this file is co-processed with the rest of std/math, and
    ;; `math.lisp` already owns `abs`/`min`/`max`. Distinct names keep the two out of each other's way.

    (fn absr [x <- Real] -> Real (if (< x 0.0) (- 0.0 x) x))
    (fn mini [a <- Int b <- Int] -> Int (if (< a b) a b))

    ;; Cosine clamped into acos's domain. See the header: rounding can push a legitimate cosine just
    ;; past 1.0, and acos answers NaN there rather than 0.
    (fn clamp1 [x <- Real] -> Real (
        (if (< x -1.0) (return -1.0))
        (if (> x 1.0) (return 1.0))
        (return x)))

    ;; Overflow-safe magnitudes: divide through by the largest component before squaring. The `== 0.0`
    ;; guard is not an optimisation -- without it a genuine zero vector divides 0/0 and the sqrt is NaN.
    (fn hyp2 [x <- Real y <- Real] -> Real (
        (let ax (absr x))
        (let ay (absr y))
        (let m (if (> ax ay) ax ay))
        (if (== m 0.0) (return 0.0))
        (let rx (/ x m))
        (let ry (/ y m))
        (return (* m (Math.sqrt (+ (* rx rx) (* ry ry)))))))

    (fn hyp3 [x <- Real y <- Real z <- Real] -> Real (
        (let ax (absr x))
        (let ay (absr y))
        (let az (absr z))
        (mut m ax)
        (if (> ay m) (m := ay))
        (if (> az m) (m := az))
        (if (== m 0.0) (return 0.0))
        (let rx (/ x m))
        (let ry (/ y m))
        (let rz (/ z m))
        (return (* m (Math.sqrt (+ (* rx rx) (+ (* ry ry) (* rz rz))))))))

    (fn hypn [comps <- Real[]] -> Real (
        (let n comps.length)
        (mut m <- Real 0.0)
        (mut i <- Int 0)
        (while (< i n) (
            (let a (absr comps[i]))
            (if (> a m) (m := a))
            (i := (+ i 1))))
        (if (== m 0.0) (return 0.0))
        (mut sum <- Real 0.0)
        (i := 0)
        (while (< i n) (
            (let r (/ comps[i] m))
            (sum := (+ sum (* r r)))
            (i := (+ i 1))))
        (return (* m (Math.sqrt sum)))))

    ;; =============================================================================================
    ;; Vec2 -- the 2D value type.
    ;; =============================================================================================
    (defstruct Vec2
        (let :ctor x <- Real 0.0)
        (let :ctor y <- Real 0.0)

        ;; -- field operators (D57): + - vector-on-vector, unary - negate, * / scalar-on-the-RIGHT ---
        (fn :operator + [o <- Vec2] -> Vec2 (return (Vec2 (+ this.x o.x) (+ this.y o.y))))
        (fn :operator - [o <- Vec2] -> Vec2 (return (Vec2 (- this.x o.x) (- this.y o.y))))
        (fn :operator - [] -> Vec2 (return (Vec2 (- 0.0 this.x) (- 0.0 this.y))))
        (fn :operator * [k <- Real] -> Vec2 (return (Vec2 (* this.x k) (* this.y k))))
        (fn :operator / [k <- Real] -> Vec2 (return (Vec2 (/ this.x k) (/ this.y k))))

        ;; The scalar-multiply spelling that survives scalar-on-the-left (header). `(v.scale k)`.
        (fn scale [k <- Real] -> Vec2 (return (Vec2 (* this.x k) (* this.y k))))

        ;; -- products -------------------------------------------------------------------------------
        (fn dot [o <- Vec2] -> Real (return (+ (* this.x o.x) (* this.y o.y))))

        ;; The 2D "cross": a SCALAR, the z of the 3D cross of the embedded vectors. Named so it cannot be
        ;; mistaken for a vector. Positive when `o` is counter-clockwise from `this`.
        (fn perp-dot [o <- Vec2] -> Real (return (- (* this.x o.y) (* this.y o.x))))

        ;; The vector-valued 2D rotation by +90 degrees: `(x,y) -> (-y,x)`.
        (fn perp [] -> Vec2 (return (Vec2 (- 0.0 this.y) this.x)))

        ;; -- magnitude ------------------------------------------------------------------------------
        (fn length-sq [] -> Real (return (+ (* this.x this.x) (* this.y this.y))))
        (fn length [] -> Real (return (hyp2 this.x this.y)))

        (fn normalise [] -> Vec2 (
            (let m (this.length))
            (if (== m 0.0) (return (Vec2 0.0 0.0)))
            (return (Vec2 (/ this.x m) (/ this.y m)))))

        (fn distance [o <- Vec2] -> Real (return (hyp2 (- this.x o.x) (- this.y o.y))))

        ;; Angle between the two directions, in radians, in [0, pi]. See header: round the result if you
        ;; need it identical across backends, and note it is 0 when either vector is zero.
        (fn angle-between [o <- Vec2] -> Real (
            (let la (this.length))
            (let lo (o.length))
            (if (== la 0.0) (return 0.0))
            (if (== lo 0.0) (return 0.0))
            ;; Cosine from the UNIT vectors, NOT the naive `(this.dot o)/(la*lo)`. That quotient forms
            ;; two products that each overflow to +Inf once a component passes ~1e154 -- and underflow
            ;; to 0 below ~1e-162 -- and Inf/Inf (or 0/0) is NaN, so the angle between two large, or two
            ;; tiny, PARALLEL vectors came back NaN instead of 0. MEASURED before this change: components
            ;; 1e200 and 1e-200 both gave NaN on BOTH backends. It also silently threw away the whole
            ;; point of the scaled `length` above -- overflow-safe magnitude defeated one line later.
            ;; Dividing through `length` (itself overflow-safe) bounds every unit component to [-1,1], so
            ;; `ua.dot ub` cannot overflow; it equals the quotient to the ULP at normal scale. The one
            ;; cost is two extra divides; the quotient only "won" until it was catastrophically wrong.
            (let ua (this.normalise))
            (let ub (o.normalise))
            (return (Math.acos (clamp1 (ua.dot ub))))))

        ;; -- combinators ----------------------------------------------------------------------------
        ;; `lerp` at t=0 is `this`, at t=1 is `o`; written `this + (o-this)*t` so those endpoints are
        ;; exact rather than a rounded `this*(1-t)+o*t`.
        (fn lerp [o <- Vec2 t <- Real] -> Vec2 (
            (return (Vec2 (+ this.x (* (- o.x this.x) t))
                          (+ this.y (* (- o.y this.y) t))))))

        ;; Reflect across the plane with unit normal `n`: `v - 2(v.n)n`. `n` MUST be normalised -- the
        ;; formula assumes |n|=1, and a non-unit normal scales the reflection.
        (fn reflect [n <- Vec2] -> Vec2 (
            (let d (* 2.0 (this.dot n)))
            (return (Vec2 (- this.x (* d n.x)) (- this.y (* d n.y))))))

        ;; Vector projection of `this` onto `o`: the component of `this` along `o`. Zero when `o` is zero
        ;; (no direction to project onto), which is the non-trapping answer.
        (fn project [o <- Vec2] -> Vec2 (
            (let dd (o.dot o))
            (if (== dd 0.0) (return (Vec2 0.0 0.0)))
            (let s (/ (this.dot o) dd))
            (return (Vec2 (* o.x s) (* o.y s)))))

        ;; -- equality: exact, and tolerant. Two `Real`s that should match frequently do not, so the ---
        ;; tolerant form is the one most callers want. `near` is componentwise |dx|<=tol (no sqrt, so no
        ;; rounding of its own); `eq` is bit-exact and is the honest name for that.
        (fn eq [o <- Vec2] -> Boolean (return (and (== this.x o.x) (== this.y o.y))))
        (fn near [o <- Vec2 tol <- Real] -> Boolean
            (return (and (<= (absr (- this.x o.x)) tol) (<= (absr (- this.y o.y)) tol))))

        (fn to-string [] -> String (return f"({(this.x)}, {(this.y)})"))

        ;; -- notation -------------------------------------------------------------------------------
        ;; OPTIONAL glyph synonyms, one-line delegates to the ASCII names above. They exist only in
        ;; MEMBER position, where the two backends' manglers agree byte-for-byte (measured); they are
        ;; drawn from the U+2000+ Mathematical-Operators block, never the Latin-1 look-alikes `.`/`x`;
        ;; and nothing here is reachable ONLY through a glyph. Delete this section and the module is
        ;; still complete. `.` dot, `||` norm, `_|_` perp.
        (fn ⋅ [o <- Vec2] -> Real (return (this.dot o)))
        (fn ‖ [] -> Real (return (this.length)))
        (fn ⊥ [] -> Vec2 (return (this.perp))))

    ;; =============================================================================================
    ;; Vec3 -- the 3D value type. Same shape as Vec2 with z, plus the real cross product.
    ;; =============================================================================================
    (defstruct Vec3
        (let :ctor x <- Real 0.0)
        (let :ctor y <- Real 0.0)
        (let :ctor z <- Real 0.0)

        (fn :operator + [o <- Vec3] -> Vec3 (return (Vec3 (+ this.x o.x) (+ this.y o.y) (+ this.z o.z))))
        (fn :operator - [o <- Vec3] -> Vec3 (return (Vec3 (- this.x o.x) (- this.y o.y) (- this.z o.z))))
        (fn :operator - [] -> Vec3 (return (Vec3 (- 0.0 this.x) (- 0.0 this.y) (- 0.0 this.z))))
        (fn :operator * [k <- Real] -> Vec3 (return (Vec3 (* this.x k) (* this.y k) (* this.z k))))
        (fn :operator / [k <- Real] -> Vec3 (return (Vec3 (/ this.x k) (/ this.y k) (/ this.z k))))

        (fn scale [k <- Real] -> Vec3 (return (Vec3 (* this.x k) (* this.y k) (* this.z k))))

        (fn dot [o <- Vec3] -> Real
            (return (+ (* this.x o.x) (+ (* this.y o.y) (* this.z o.z)))))

        ;; The genuine cross product: perpendicular to both, magnitude |a||b|sin(theta), right-handed.
        (fn cross [o <- Vec3] -> Vec3 (
            (return (Vec3 (- (* this.y o.z) (* this.z o.y))
                          (- (* this.z o.x) (* this.x o.z))
                          (- (* this.x o.y) (* this.y o.x))))))

        (fn length-sq [] -> Real (return (+ (* this.x this.x) (+ (* this.y this.y) (* this.z this.z)))))
        (fn length [] -> Real (return (hyp3 this.x this.y this.z)))

        (fn normalise [] -> Vec3 (
            (let m (this.length))
            (if (== m 0.0) (return (Vec3 0.0 0.0 0.0)))
            (return (Vec3 (/ this.x m) (/ this.y m) (/ this.z m)))))

        (fn distance [o <- Vec3] -> Real (return (hyp3 (- this.x o.x) (- this.y o.y) (- this.z o.z))))

        ;; Cosine from the UNIT vectors -- see the Vec2 note: the naive quotient overflows/underflows to
        ;; NaN for large or tiny parallel vectors and defeats the overflow-safe `length` above.
        (fn angle-between [o <- Vec3] -> Real (
            (let la (this.length))
            (let lo (o.length))
            (if (== la 0.0) (return 0.0))
            (if (== lo 0.0) (return 0.0))
            (let ua (this.normalise))
            (let ub (o.normalise))
            (return (Math.acos (clamp1 (ua.dot ub))))))

        (fn lerp [o <- Vec3 t <- Real] -> Vec3 (
            (return (Vec3 (+ this.x (* (- o.x this.x) t))
                          (+ this.y (* (- o.y this.y) t))
                          (+ this.z (* (- o.z this.z) t))))))

        (fn reflect [n <- Vec3] -> Vec3 (
            (let d (* 2.0 (this.dot n)))
            (return (Vec3 (- this.x (* d n.x)) (- this.y (* d n.y)) (- this.z (* d n.z))))))

        (fn project [o <- Vec3] -> Vec3 (
            (let dd (o.dot o))
            (if (== dd 0.0) (return (Vec3 0.0 0.0 0.0)))
            (let s (/ (this.dot o) dd))
            (return (Vec3 (* o.x s) (* o.y s) (* o.z s)))))

        (fn eq [o <- Vec3] -> Boolean
            (return (and (== this.x o.x) (and (== this.y o.y) (== this.z o.z)))))
        (fn near [o <- Vec3 tol <- Real] -> Boolean
            (return (and (<= (absr (- this.x o.x)) tol)
                         (and (<= (absr (- this.y o.y)) tol)
                              (<= (absr (- this.z o.z)) tol)))))

        (fn to-string [] -> String (return f"({(this.x)}, {(this.y)}, {(this.z)})"))

        ;; -- notation -- see the Vec2 notation note. `.` dot, `x` cross (U+2A2F, not U+00D7), `||` norm.
        (fn ⋅ [o <- Vec3] -> Real (return (this.dot o)))
        (fn ⨯ [o <- Vec3] -> Vec3 (return (this.cross o)))
        (fn ‖ [] -> Real (return (this.length))))

    ;; =============================================================================================
    ;; Vec -- the general n-dimensional vector over a flat Real[].
    ;;
    ;; The backing array is a REFERENCE, so two Vecs built from the same array alias it. Every operation
    ;; here returns a FRESH array, so results never alias their inputs; only a `Vec` you build directly
    ;; from an array you keep mutating can surprise you. Mismatched dimensions clamp to the smaller (see
    ;; header) rather than trap.
    ;; =============================================================================================
    (defstruct Vec
        (let :ctor comps <- Real[])

        (fn size [] -> Int (return this.comps.length))
        (fn at [i <- Int] -> Real (return this.comps[i]))

        (fn :operator + [o <- Vec] -> Vec (
            (let n (mini this.comps.length o.comps.length))
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (out.push (+ this.comps[i] o.comps[i]))
                (i := (+ i 1))))
            (return (Vec out))))

        (fn :operator - [o <- Vec] -> Vec (
            (let n (mini this.comps.length o.comps.length))
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (out.push (- this.comps[i] o.comps[i]))
                (i := (+ i 1))))
            (return (Vec out))))

        (fn :operator - [] -> Vec (return (this.scale (- 0.0 1.0))))

        (fn :operator * [k <- Real] -> Vec (return (this.scale k)))
        (fn :operator / [k <- Real] -> Vec (
            (let n this.comps.length)
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (out.push (/ this.comps[i] k))
                (i := (+ i 1))))
            (return (Vec out))))

        (fn scale [k <- Real] -> Vec (
            (let n this.comps.length)
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (out.push (* this.comps[i] k))
                (i := (+ i 1))))
            (return (Vec out))))

        (fn dot [o <- Vec] -> Real (
            (let n (mini this.comps.length o.comps.length))
            (mut s <- Real 0.0)
            (mut i <- Int 0)
            (while (< i n) (
                (s := (+ s (* this.comps[i] o.comps[i])))
                (i := (+ i 1))))
            (return s)))

        (fn length-sq [] -> Real (return (this.dot this)))
        (fn length [] -> Real (return (hypn this.comps)))

        (fn normalise [] -> Vec (
            (let m (this.length))
            (let n this.comps.length)
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (if (== m 0.0) (
                (while (< i n) ((out.push 0.0) (i := (+ i 1))))
                (return (Vec out))))
            (while (< i n) (
                (out.push (/ this.comps[i] m))
                (i := (+ i 1))))
            (return (Vec out))))

        (fn distance [o <- Vec] -> Real (
            (let n (mini this.comps.length o.comps.length))
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (out.push (- this.comps[i] o.comps[i]))
                (i := (+ i 1))))
            (return (hypn out))))

        ;; Cosine from the UNIT vectors -- see the Vec2 note. This matters MOST here: an n-dim `dot`
        ;; sums n products, so `this.dot o` overflows far sooner than a component reaching 1e154 (an
        ;; embedding of 1e160-scale components overflows the sum well before that), which is exactly the
        ;; large-vector case this general type exists for. Normalising first keeps every term in [-1,1].
        (fn angle-between [o <- Vec] -> Real (
            (let la (this.length))
            (let lo (o.length))
            (if (== la 0.0) (return 0.0))
            (if (== lo 0.0) (return 0.0))
            (let ua (this.normalise))
            (let ub (o.normalise))
            (return (Math.acos (clamp1 (ua.dot ub))))))

        (fn lerp [o <- Vec t <- Real] -> Vec (
            (let n (mini this.comps.length o.comps.length))
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (while (< i n) (
                (let a this.comps[i])
                (out.push (+ a (* (- o.comps[i] a) t)))
                (i := (+ i 1))))
            (return (Vec out))))

        ;; Projection of `this` onto `o`; zero vector (of o's dimension) when `o` has no length.
        (fn project [o <- Vec] -> Vec (
            (let dd (o.dot o))
            (let n o.comps.length)
            (mut out <- Real[] [])
            (mut i <- Int 0)
            (if (== dd 0.0) (
                (while (< i n) ((out.push 0.0) (i := (+ i 1))))
                (return (Vec out))))
            (let s (/ (this.dot o) dd))
            (while (< i n) (
                (out.push (* o.comps[i] s))
                (i := (+ i 1))))
            (return (Vec out))))

        ;; Different dimensions are never equal (and never within tolerance) -- there is no meaningful
        ;; componentwise comparison across a length mismatch.
        (fn eq [o <- Vec] -> Boolean (
            (if (!= this.comps.length o.comps.length) (return #f))
            (let n this.comps.length)
            (mut i <- Int 0)
            (while (< i n) (
                (if (!= this.comps[i] o.comps[i]) (return #f))
                (i := (+ i 1))))
            (return #t)))

        (fn near [o <- Vec tol <- Real] -> Boolean (
            (if (!= this.comps.length o.comps.length) (return #f))
            (let n this.comps.length)
            (mut i <- Int 0)
            (while (< i n) (
                (if (> (absr (- this.comps[i] o.comps[i])) tol) (return #f))
                (i := (+ i 1))))
            (return #t)))

        (fn to-string [] -> String (
            (let n this.comps.length)
            (mut s <- String "(")
            (mut i <- Int 0)
            (while (< i n) (
                (if (> i 0) (s := f"{s}, "))
                (s := f"{s}{(this.comps[i])}")
                (i := (+ i 1))))
            (return f"{s})")))

        ;; -- notation -- see the Vec2 notation note. `.` dot, `||` norm.
        (fn ⋅ [o <- Vec] -> Real (return (this.dot o)))
        (fn ‖ [] -> Real (return (this.length))))

    (export Vec2 Vec3 Vec)
)

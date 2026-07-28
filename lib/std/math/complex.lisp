;; std/math/complex -- the complex field C, as a value struct with the five admitted operators.
;;
;; A `Complex` is two `Real`s, `re` and `im`, and every operation returns a FRESH `Complex` -- it is a
;; number, not a mutable cell, so it is a `defstruct` (value semantics) and nothing here writes a field
;; of an existing value. That is also why the constructor takes the two components positionally:
;; `(Complex 3.0 4.0)` is 3+4i, and the reader-facing `(rect 3.0 4.0)` / `(polar r theta)` say which
;; coordinate system the two numbers are in.
;;
;; -----------------------------------------------------------------------------------------------
;; THE FIELDS ARE `Real`, NEVER `Int | Real`, AND THAT IS LOAD-BEARING.
;;
;; Under D49d `Int / Int` is INTEGER division. A `Complex` whose fields were the `Int|Real` union would
;; let `(Complex 1 2)` construct with Int components, and then `(/ (Complex 1 2) (Complex 3 4))` would
;; compute its real part as an integer division and return 0 where 0.44 was meant -- a silent wrong
;; answer, the exact class FLOOR.md exists to kill. Declaring the fields `Real` forces every caller
;; through a float, so the division inside `/` `exp` `log` `sqrt` is always real division. `(rect ...)`
;; and `(polar ...)` take `Real` for the same reason; hand them Int literals and l-lang's Int->Real
;; promotion lifts them at the call, so `(rect 1 2)` is fine while the fields stay Real.
;;
;; -----------------------------------------------------------------------------------------------
;; OPERATORS: exactly the five the D57 ruling admits, as METHODS.
;;
;;   + - * /   and unary -   -- the field operations, `this` is the left operand.
;;
;; Everything else is an ASCII name or method: `abs arg conj recip eq near dot`-free algebra reads as
;; the algebra it is, and a symbol that would LEAVE the type or has no scalar analogue is refused. In
;; particular there is NO `==` (it silently redefines `!=` differently per backend -- MEASURED
;; `ne false` on JS, `ne true` on C); use `(a.eq b)` for exact structural equality and `(a.near b tol)`
;; for the tolerant comparison a float type actually wants. Scalar multiply keeps the scalar to the
;; RIGHT via `(c.scaled k)`, and the scalar-on-the-LEFT spelling is the free name `(scale k c)` -- never
;; `(* k c)`, which is `nil` on JS and `ELL0106` on C (MEASURED: C's `mkBinop` dispatches on the left
;; operand's static ctype, and a primitive on the left has no method to find).
;;
;; A small OPTIONAL glyph layer lives in the `;; -- notation --` block: `‖ ∠ † ≈`, one-line delegates
;; to `abs arg conj near`, drawn from U+2000+ (the Latin-1 look-alikes `·`/`×` are banned -- their hex
;; JS-encoding collides with a writable ASCII name; a U+2016 glyph encodes to `_2016`, whose only
;; colliding ASCII spelling `2016` is not lexable). The ASCII name is the graded, greppable spelling;
;; the glyphs are synonyms and every one has a call site in examples/40-math on both backends. Delete
;; the whole block and the module is still complete.
;;
;; -----------------------------------------------------------------------------------------------
;; THE LITERAL THIS IS MEANT TO BACK.
;;
;; A future complex literal `3+4i` desugars to `(rect 3.0 4.0)` and a bare `i` to the exported unit `I`
;; (`(Complex 0.0 1.0)`), so `a+bi` is `(rect a b)` and `2i` is `(scale 2.0 I)`. Nothing in the API is
;; reachable only through the eventual reader syntax -- the desugaring targets names that already exist
;; and are tested here.
;;
;; -----------------------------------------------------------------------------------------------
;; TWO NUMERICAL CHOICES THAT ARE NOT THE TEXTBOOK ONES, both because the textbook one OVERFLOWS.
;;
;;   * `abs` is a hypot, not `sqrt(re*re + im*im)`. The naive square-of-sum overflows to +Inf once a
;;     component passes ~1.34e154 (its square exceeds the ~1.8e308 Real max) even when the true
;;     magnitude is finite; the hypot form `|a|*sqrt(1+(b/a)^2)` only overflows when the answer itself
;;     does. Same accuracy (~1 ulp), a factor ~2e154 more range.
;;   * `/` is Smith's algorithm (1962), not `(ac+bd)/(c*c+d*d) + ...`. The naive denominator `c*c+d*d`
;;     overflows at the same ~1e154 the naive abs does, and underflows to 0.0 (a spurious Inf quotient)
;;     for tiny divisors. Smith scales by the larger component first, so it divides accurately across
;;     the whole finite range. This is a real defect in the shipped `math.lisp` Complex, which uses the
;;     naive form -- worth the extra branch.
;;
;; -----------------------------------------------------------------------------------------------
;; SELF-CONTAINED ON PURPOSE. Its only import is `std/core/protocols` -- a genuine leaf, added by D88
;; so a Complex renders through `Formattable` and `3+4i` prints as itself rather than as
;; `Complex{:re 3 :im 4}`; a numeric literal that does not print like a number reads as a leaked
;; implementation detail. Beyond that the module leans on nothing, and the
;; std/math foundation it would otherwise lean on (`core`'s `fmt-fixed`, `elementary`'s `hypot2`/`sinh`)
;; is being written in parallel. So the hypot, the fixed-decimal formatter, and `sinh`/`cosh` are
;; INLINED below as small private shims; when `core` and `elementary` land they move there and this file
;; imports them. `real-fixed` is exported only because a caller has no other dependency-free way to print
;; a scalar (a magnitude, an argument) deterministically -- `.toFixed` traps on C (exit 70, MEASURED),
;; so a float golden cannot go through it. It is `core.fmt-fixed` in miniature, named apart so the two
;; can coexist when both are compiled as siblings of this package.
(
    (import "std/core/protocols")

    ;; -- private float shims (destined for core/elementary) ----------------------------------------

    ;; A single decimal digit's glyph, chosen by half-open band. `d` is always an EXACT integer-valued
    ;; Real in [0,10) at the call sites below, so the bands are never on a rounding boundary. This exists
    ;; because the alternative -- interpolating a numeric digit -- diverges: a JS Number `1` renders "1"
    ;; while a C Real `1.0` renders "1.0", so the digit has to be turned into a string HERE, by branch,
    ;; not by the display layer.
    (fn digit-of [d <- Real] -> String
        (if (< d 1.0) (return "0"))
        (if (< d 2.0) (return "1"))
        (if (< d 3.0) (return "2"))
        (if (< d 4.0) (return "3"))
        (if (< d 5.0) (return "4"))
        (if (< d 6.0) (return "5"))
        (if (< d 7.0) (return "6"))
        (if (< d 8.0) (return "7"))
        (if (< d 9.0) (return "8"))
        (return "9"))

    ;; Format a Real to exactly `n` decimal places, portably. The private stand-in for core.fmt-fixed:
    ;; `.toFixed` traps on the C backend (exit 70, MEASURED), so display and every float golden route
    ;; through here instead.
    ;;
    ;; Deliberately kept in the Real domain end to end -- no `Math.trunc`-to-Int, no integer division.
    ;; MEASURED why: an `Int`-typed value produced by `Math.trunc` is a JS Number, not a BigInt, and when
    ;; `Int/Int` division falls to the runtime dispatcher it reconciles the operands as floats, so
    ;; `(/ 1200 10000)` came out 0.12 on JS and 0 on C -- `real-fixed 0.12 4` was "0.12.0000" vs
    ;; "0.1200". Working with integer-VALUED doubles and flooring by hand keeps both backends on the one
    ;; arithmetic. Rounds half up on the non-negative magnitude (sign split off first). The double holds
    ;; the scaled value exactly up to ~15 significant digits; past that the low place is unreliable, which
    ;; is the honest ceiling for a fixed-decimal formatter over binary floats.
    (fn real-fixed [x <- Real n <- Int] -> String
        ;; Non-finite guard, and it is a TERMINATION fix, not a cosmetic one. The digit-peel loop
        ;; below runs `while (> rem 0.5)`, and for a non-finite `rem` that condition never clears:
        ;; `Math.floor(Inf/10)` is `Inf`, so `rem` stays `Inf` and the loop appends a digit forever.
        ;; MEASURED feeding `Inf` (an `abs2` that overflowed, which this module documents can happen,
        ;; or a `/` by a zero divisor): the string grows without bound -- JS dies with a heap OOM, C
        ;; spins allocating. A NaN does terminate but printed garbage ("0.9999..."), the `digit-of`
        ;; fallthrough for a value that fails every band. Both are caught here and mapped to a token.
        ;;
        ;; Detection is `x - x`: exactly 0.0 for every finite x, NaN for +/-Inf and for NaN itself
        ;; (Inf-Inf and NaN-NaN are both NaN), so `(x - x) != 0` screens all three. Chosen over the
        ;; `abs(x) <= MAXDBL` test because the MAXDBL literal `1.79e308` is miscompiled on the C
        ;; backend when this function is inlined from an import -- it is emitted as `INT64_C(1.79e308)`
        ;; (invalid C, REPORTED). `x - x` needs no large literal and is byte-identical on both.
        (if (not (== (- x x) 0.0))
            (
                (if (== x x) (return (if (< x 0.0) "-inf" "inf")))  ;; x==x rules out NaN -> signed Inf
                (return "nan")
            ))
        (mut neg <- Boolean #f)
        (mut v <- Real x)
        (if (< v 0.0) ((neg := #t) (v := (- 0.0 v))))
        (mut scale <- Real 1.0)
        (mut kk <- Int 0)
        (while (< kk n) ((scale := (* scale 10.0)) (kk := (+ kk 1))))
        ;; scaled is an integer-valued double: round-half-up, then stay in floating point.
        (mut rem <- Real (Math.floor (+ (* v scale) 0.5)))
        (if (== rem 0.0) (neg := #f))             ;; never render "-0.00"
        (mut frac <- String "")
        (mut ipart <- String "")
        (mut idx <- Int 0)
        ;; Peel decimal digits least-significant first: the first `n` are the fraction, the rest the
        ;; integer part. Continue while fraction digits are still owed OR an integer remainder is left.
        (while (or (< idx n) (> rem 0.5))
            (
                (let q (Math.floor (/ rem 10.0)))
                (let dv (- rem (* q 10.0)))        ;; the last digit, an exact 0.0..9.0
                (let ch (digit-of dv))
                (if (< idx n)
                    (frac := '"{ch}{frac}")
                    (ipart := '"{ch}{ipart}"))
                (rem := q)
                (idx := (+ idx 1))
            ))
        (if (== ipart "") (ipart := "0"))         ;; a pure fraction still has a leading "0"
        (let sgn (if neg "-" ""))
        (if (<= n 0) (return '"{sgn}{ipart}"))
        (return '"{sgn}{ipart}.{frac}"))

    ;; Hyperbolic sine/cosine, needed by the complex trig identities. Exponential form: accurate to a
    ;; few ulp for moderate |x|, but `rsinh` near 0 loses precision to the `e^x - e^-x` cancellation
    ;; (elementary's expm1-based version is the fix) and both overflow to Inf past |x| ~ 710. The
    ;; complex trig below inherits exactly that regime: fine for arguments with modest imaginary part.
    ;;
    ;; Named `rsinh`/`rcosh`, not `sinh`/`cosh`: `std/math/elementary` now EXPORTS `sinh`/`cosh`, and
    ;; every sibling of this package is co-processed together (D35/Mb), so an unqualified `sinh` here
    ;; would be a cross-module duplicate the flat resolver could bind either way. This module imports
    ;; nothing, so its helpers must not answer to a name another module in the package also claims.
    (fn rsinh [x <- Real] -> Real (return (* 0.5 (- (Math.exp x) (Math.exp (- 0.0 x))))))
    (fn rcosh [x <- Real] -> Real (return (* 0.5 (+ (Math.exp x) (Math.exp (- 0.0 x))))))

    ;; -- the type ----------------------------------------------------------------------------------

    (defstruct Complex :implements Formattable
        (let :ctor re <- Real 0.0)
        (let :ctor im <- Real 0.0)

        ;; -- components -----------------------------------------------------------------------------
        ;; The fields `re`/`im` are already public; `real`/`imag` are the spoken names, and the pair a
        ;; literal's accessors would compile to.
        (fn real [] -> Real (return this.re))
        (fn imag [] -> Real (return this.im))

        ;; -- magnitude and phase --------------------------------------------------------------------

        ;; |z|, overflow-safe (see header). Reduces to |a|*sqrt(1+(b/a)^2) with the larger component
        ;; factored out. Exact zero short-circuits so 0/0 never appears.
        (fn abs [] -> Real
            (let a (Math.abs this.re))
            (let b (Math.abs this.im))
            (if (and (== a 0.0) (== b 0.0)) (return 0.0))
            (if (>= a b)
                (
                    (let r (/ b a))
                    (return (* a (Math.sqrt (+ 1.0 (* r r)))))
                )
                (
                    (let r (/ a b))
                    (return (* b (Math.sqrt (+ 1.0 (* r r)))))
                )))

        ;; |z|^2 = re^2 + im^2. Cheaper than `abs` and exact-ish, but it DOES overflow past ~1.34e154 per
        ;; component -- use it only where the magnitude is known bounded (it is the natural norm for a
        ;; tolerance on already-normalised values, not a general-purpose length).
        (fn abs2 [] -> Real (return (+ (* this.re this.re) (* this.im this.im))))

        ;; arg(z) in (-pi, pi], the principal argument. `atan2` gets the quadrant right where
        ;; `atan(im/re)` cannot; arg(0) is 0 by the atan2 convention.
        (fn arg [] -> Real (return (Math.atan2 this.im this.re)))

        ;; -- structure ------------------------------------------------------------------------------

        (fn conj [] -> Complex (return (Complex this.re (- 0.0 this.im))))

        ;; 1/z via Smith's algorithm -- same overflow argument as `/` below, specialised to a unit
        ;; numerator so no complex multiply is needed.
        (fn recip [] -> Complex
            (let c this.re)
            (let d this.im)
            (if (>= (Math.abs c) (Math.abs d))
                (
                    (let r (/ d c))
                    (let den (+ c (* d r)))
                    (return (Complex (/ 1.0 den) (/ (- 0.0 r) den)))
                )
                (
                    (let r (/ c d))
                    (let den (+ (* c r) d))
                    (return (Complex (/ r den) (/ (- 0.0 1.0) den)))
                )))

        ;; Scalar multiply, scalar on the RIGHT (the only side an operator could carry -- see header).
        (fn scaled [k <- Real] -> Complex (return (Complex (* this.re k) (* this.im k))))

        ;; -- the five admitted operators ------------------------------------------------------------

        (fn :operator + [o <- Complex] -> Complex
            (return (Complex (+ this.re o.re) (+ this.im o.im))))

        (fn :operator - [o <- Complex] -> Complex
            (return (Complex (- this.re o.re) (- this.im o.im))))

        ;; (a+bi)(c+di) = (ac-bd) + (ad+bc)i. Karatsuba's 3-multiply form is deliberately NOT used: it
        ;; trades one multiply for two adds and loses a bit of accuracy, which is the wrong trade on
        ;; hardware where a multiply is a multiply.
        (fn :operator * [o <- Complex] -> Complex
            (return (Complex
                (- (* this.re o.re) (* this.im o.im))
                (+ (* this.re o.im) (* this.im o.re)))))

        ;; Smith's algorithm (1962). The naive `(ac+bd)/(cc+dd)` overflows and underflows in the
        ;; denominator; scaling by the larger of |c|,|d| first keeps every intermediate in range. See
        ;; the header for the regime the naive form fails in.
        (fn :operator / [o <- Complex] -> Complex
            (let a this.re)
            (let b this.im)
            (let c o.re)
            (let d o.im)
            (if (>= (Math.abs c) (Math.abs d))
                (
                    (let r (/ d c))
                    (let den (+ c (* d r)))
                    (return (Complex (/ (+ a (* b r)) den) (/ (- b (* a r)) den)))
                )
                (
                    (let r (/ c d))
                    (let den (+ (* c r) d))
                    (return (Complex (/ (+ (* a r) b) den) (/ (- (* b r) a) den)))
                )))

        (fn :operator - [] -> Complex (return (Complex (- 0.0 this.re) (- 0.0 this.im))))

        ;; -- elementary functions -------------------------------------------------------------------

        ;; exp(a+bi) = e^a (cos b + i sin b). Accurate to ~1 ulp; overflows once a > ~709 (e^a does).
        (fn exp [] -> Complex
            (let ea (Math.exp this.re))
            (return (Complex (* ea (Math.cos this.im)) (* ea (Math.sin this.im)))))

        ;; Principal log: ln|z| + i·arg(z), branch cut on the negative real axis, imaginary part in
        ;; (-pi, pi]. `abs` (the hypot) keeps ln|z| finite up to the full Real range. Accuracy ~1-2 ulp
        ;; AWAY from the unit circle; for |z| very near 1 the ln suffers cancellation (elementary's
        ;; log1p is the fix, and is where a future version routes this).
        (fn log [] -> Complex
            (let m (this.abs))
            (return (Complex (Math.log m) (this.arg))))

        ;; Principal square root, the numerically stable branch. The naive `sqrt(r+a)` /
        ;; `sqrt(r-a)` pair cancels catastrophically for one sign of `a`; here the well-conditioned
        ;; component is computed with a sqrt and the other is recovered by division, so both parts keep
        ;; full precision. Result has non-negative real part (the principal branch).
        (fn sqrt [] -> Complex
            (let a this.re)
            (let b this.im)
            (if (and (== a 0.0) (== b 0.0)) (return (Complex 0.0 0.0)))
            (let m (this.abs))
            (if (>= a 0.0)
                (
                    (let re (Math.sqrt (* 0.5 (+ m a))))
                    (return (Complex re (/ b (* 2.0 re))))
                )
                (
                    (let t (Math.sqrt (* 0.5 (- m a))))
                    (let im (if (< b 0.0) (- 0.0 t) t))   ;; carry sign(b); b=0 -> +i branch (principal)
                    (return (Complex (/ b (* 2.0 im)) im))
                )))

        ;; Integer power by LINEAR repeated multiply. Preferred over `pow` for an integer exponent: it
        ;; is the repeated field multiply, so it has NO branch cut and no transcendental error -- z^2 is
        ;; exactly (z*z), where `(pow z (rect 2 0))` goes through exp/log and lands a few ulp off.
        ;; Negative exponents go through `recip`.
        ;;
        ;; Binary exponentiation would be the textbook choice, but it needs `e/2`, and `(/ Int Int)`
        ;; MISCOMPILES to REAL division inside a method body (a compiler bug, REPORTED: the same
        ;; expression integer-divides correctly in a free function; here `e` walks 8,4,2,1,0.5,0.25,...
        ;; and never reaches 0 on JS while C truncates 0.5 to 0 and exits early -- a live backend
        ;; divergence). The countdown below is `e - 1`, which reaches 0 exactly no matter how the type
        ;; is inferred, so this loop is immune. O(n) is fine for the small exponents an integer power is
        ;; ever asked for; anything large should use `pow`.
        (fn powi [n <- Int] -> Complex
            (if (< n 0)
                (
                    (let p (this.powi (- 0 n)))
                    (return (p.recip))
                ))
            (mut result <- Complex (Complex 1.0 0.0))
            (mut e <- Int n)
            (while (> e 0)
                (
                    (result := (* result (Complex this.re this.im)))
                    (e := (- e 1))
                ))
            (return result))

        ;; General power z^w = exp(w · log z), principal branch (inherits log's cut). 0^0 is 1 by
        ;; convention; 0^w (w != 0) is 0. Accuracy is that of log then exp, a few ulp off the unit
        ;; circle. For an integer exponent prefer `powi` -- it is exact where this is not.
        (fn pow [w <- Complex] -> Complex
            (if (and (== this.re 0.0) (== this.im 0.0))
                (
                    (if (and (== w.re 0.0) (== w.im 0.0)) (return (Complex 1.0 0.0)))
                    (return (Complex 0.0 0.0))
                ))
            (let lz (this.log))
            (let wl (* w lz))
            (return (wl.exp)))

        ;; sin/cos/tan via the real identities. sin(a+bi) = sin a cosh b + i cos a sinh b, and the
        ;; analogous cos; tan is their quotient through the complex `/`. Accurate for modest |im|; as
        ;; |im| grows the `cosh`/`sinh` inherit the overflow noted on those shims (tan -> NaN once both
        ;; blow up), which is the honest regime for the exponential-form hyperbolics.
        (fn sin [] -> Complex
            (return (Complex
                (* (Math.sin this.re) (rcosh this.im))
                (* (Math.cos this.re) (rsinh this.im)))))
        (fn cos [] -> Complex
            (return (Complex
                (* (Math.cos this.re) (rcosh this.im))
                (- 0.0 (* (Math.sin this.re) (rsinh this.im))))))
        (fn tan [] -> Complex
            (let s (this.sin))
            (let c (this.cos))
            (return (/ s c)))

        ;; -- equality -------------------------------------------------------------------------------

        ;; Exact structural equality. This is bit-for-bit on the components and so is almost never what
        ;; you want for computed values -- reach for `near`. It exists because a hash/set key needs a
        ;; total, tolerance-free predicate.
        (fn eq [o <- Complex] -> Boolean
            (return (and (== this.re o.re) (== this.im o.im))))

        ;; |a - b| <= tol. The comparison people actually want: two Reals that "should" be equal usually
        ;; are not, so the tolerance is a required argument rather than a hidden default. The difference
        ;; is taken as a Complex so the magnitude is the overflow-safe `abs`.
        (fn near [o <- Complex tol <- Real] -> Boolean
            (let d (- this o))
            (return (<= (d.abs) tol)))

        ;; -- display --------------------------------------------------------------------------------

        ;; Render in l-lang's own `a±bi` notation to `n` decimals, through `real-fixed` so the two
        ;; backends cannot disagree in the last digit. The sign of the imaginary part is folded into the
        ;; separator -- `3-4i`, never `3+-4i`.
        (fn show [n <- Int] -> String
            (let rs (real-fixed this.re n))
            (if (< this.im 0.0)
                (return '"{rs}-{(real-fixed (- 0.0 this.im) n)}i")
                (return '"{rs}+{(real-fixed this.im n)}i")))

        ;; The default rendering: four decimals, enough to read a phase without pretending at precision
        ;; the value does not have.
        (fn str [] -> String (return (this.show 4)))

        ;; D88: the floor's display path calls `format`, so `3+4i` prints as `3.0000+4.0000i` instead
        ;; of `Complex{:re 3 :im 4}`. A bare method, not `:implements Formattable` -- this module
        ;; imports NOTHING by design (see the header), and the interface declaration would buy nothing
        ;; while `(x :of SomeInterface)` answers false on both backends.
        (fn format [] -> String (return (this.str)))

        ;; -- notation (OPTIONAL glyph synonyms, U+2000+; delete this block freely) -------------------
        ;;   ‖ U+2016  norm  -> abs        ∠ U+2220  arg   -> arg
        ;;   † U+2020  conj  -> conj       ≈ U+2248  near  -> near at a fixed 1e-9
        ;; Each is a one-line delegate to the ASCII method that does the work; the glyph is never the
        ;; only way in. `≈` fixes the tolerance `near` leaves open, at 1e-9 -- the tolerant-equality most
        ;; callers mean when they reach for the symbol.
        (fn ‖ [] -> Real (return (this.abs)))
        (fn ∠ [] -> Real (return (this.arg)))
        (fn † [] -> Complex (return (this.conj)))
        (fn ≈ [o <- Complex] -> Boolean (return (this.near o 0.000000001))))

    ;; -- constructors and the unit ------------------------------------------------------------------

    ;; Rectangular: the components as-is. The name a `a+bi` literal desugars to.
    (fn rect [re <- Real im <- Real] -> Complex (return (Complex re im)))

    ;; Polar: modulus and argument. `(polar r theta)` = r·e^(i·theta). A negative r is allowed and
    ;; simply points the other way, since cos/sin carry the sign.
    (fn polar [r <- Real theta <- Real] -> Complex
        (return (Complex (* r (Math.cos theta)) (* r (Math.sin theta)))))

    ;; Scalar times complex, scalar on the LEFT. The ONLY scalar-on-left spelling -- `(* k c)` does not
    ;; and cannot work (see header). `(scale 2.0 z)` and `(z.scaled 2.0)` are the two ends of the same
    ;; operation.
    (fn scale [k <- Real c <- Complex] -> Complex (return (Complex (* k c.re) (* k c.im))))

    ;; The imaginary unit. A bare `i` in a future literal desugars to this, so `2i` is `(scale 2.0 I)`
    ;; and `a+bi` is `(+ (rect a 0.0) (scale b I))` -- though the reader will more cheaply emit
    ;; `(rect a b)` directly.
    (let I (Complex 0.0 1.0))

    ;; D88/N3 -- PROMOTION, one declaration per source type. ONE HOP only (`hasImplicitCast` never
    ;; chains), so `Int -> Complex` cannot be reached via `Int -> Real -> Complex` and has to be its
    ;; own. Both are exact: every Int and every Real is a complex number with a zero imaginary part.
    ;;
    ;; No `Complex -> Real`: it would have to drop the imaginary part, and a promotion that silently
    ;; discards half the value is worse than a compile error.
    (defcast :implicit [r <- Real] -> Complex (Complex r 0.0))
    (defcast :implicit [n <- Int] -> Complex (Complex n 0.0))

    (export Complex rect polar scale I real-fixed)
)

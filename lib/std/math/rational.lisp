;; std/math/rational -- exact arithmetic over Int, always in lowest terms with a positive denominator.
;;
;; No import. This module is a foundation value type (the DAG puts nothing below it), so it carries
;; the four Int helpers it needs -- iabs, gcd-int, itrunc, rabs -- itself rather than reaching for
;; core. That is not duplication to be tidied away later: core does not exist yet in the build order
;; this file must survive, and D57's self-containment rule for std/math is precisely so that a value
;; type never breaks because a sibling moved. Four private one-liners is the price.
;;
;; -----------------------------------------------------------------------------------------------
;; THE CANONICAL FORM IS A CONSTRUCTOR INVARIANT, NOT A `normalise()` THE CALLER REMEMBERS TO RUN.
;;
;; Every Rational that exists is already reduced (gcd(|num|,den) = 1) with den > 0. This is enforced
;; in `:ctor init`, which runs at the end of EVERY construction, so the type has no invalid
;; inhabitants -- there is no such thing as an un-reduced Rational to accidentally read.
;;
;; The alternative -- store num/den verbatim and expose `normalise()` -- was rejected because it makes
;; correctness a property the CALLER maintains. `eq` would have to reduce defensively on both sides
;; (or 2/4 and 1/2 compare unequal); `str` would render 6/-8 instead of -3/4; a hash would differ for
;; equal values. Every consumer would re-derive the invariant, and the one that forgot would be a
;; silent wrong answer. Establishing it ONCE, at the only place a Rational comes into being, is the
;; whole design: `eq` is then field equality (measured exact -- see `eq`), `str` is a sign-free print,
;; ordering needs no defensive pass.
;;
;; The sign lives on the numerator, never the denominator. A negative denominator is moved to the
;; numerator in the ctor (6/-8 -> -3/4, measured identical on both backends), so `den > 0` is safe to
;; assume everywhere below -- which is what lets `cmp` cross-multiply without tracking sign flips.
;;
;; -----------------------------------------------------------------------------------------------
;; INT WRAPS (D51), SO EVERY OPERATION REDUCES AS EARLY AS IT CAN.
;;
;; Int is int64 and OVERFLOW WRAPS -- silently, with no trap on either backend. A numerator that
;; crosses +/-2^63 becomes a wrong value that keeps computing. Nothing here can make int64 hold a
;; number it cannot hold; what the module does is push that cliff as far out as arithmetic allows:
;;
;;   * eager reduction. The gcd in the ctor means intermediate results never carry a common factor
;;     into the next multiply -- 1000000/2000000 is stored as 1/2, and its square is 1/4, not
;;     1000000000000/4000000000000.
;;   * cross-reduction in `*` and `/`. (a/b)*(c/d) cancels gcd(a,d) and gcd(c,b) BEFORE multiplying,
;;     so the products that could overflow are the smallest the result allows (Knuth 4.5.1).
;;   * Knuth's addition. `+` never forms b*d directly; it divides through gcd(b,d) first, so two
;;     fractions with a common denominator factor add without overflowing on the denominator.
;;
;; The residual limit, stated honestly: adding or comparing two REDUCED fractions whose denominators
;; are coprime and each near 2^31 still overflows the 2^63 cross-product, and the answer wraps with no
;; diagnostic. There is no int64 rational arithmetic without this ceiling; delaying it is all a fixed
;; width allows, and a bignum numerator is a different type for a different day.
;;
;; -----------------------------------------------------------------------------------------------
;; A ZERO DENOMINATOR IS THROWN, NOT TRAPPED.
;;
;; Division by a zero denominator must fail loudly, and it must fail the SAME way on both backends. A
;; runtime trap does not qualify: an uncaught trap (BigInt `x/0n` on JS is a RangeError; the integer
;; divide on C) is CATCHABLE on JS and FATAL on C today, so a program that relied on catching it would
;; diverge. So the ctor throws an ordinary `Error` the instant den = 0 -- and an explicit throw is a
;; normal exception, caught identically on both sides (measured: one try/catch, same output on JS and
;; C). `div` and `recip` guard the numerator that is about to BECOME a denominator and throw before
;; handing a zero to the ctor, so the message names the operation rather than the internal invariant.
;;
;; -----------------------------------------------------------------------------------------------
;; INTENDED TO BACK A FRACTION LITERAL.
;;
;; The lexer already reserves `n/d` and rejects `1/0` at parse time (LL0002, "Fraction denominator
;; cannot be zero" -- see examples/90-diagnostics/00_errors.lisp). This type is the RUNTIME value such
;; a literal would construct: `3/4` desugars to `(Rational 3 4)`, and because the ctor is the reducer,
;; the literal `6/8` and the literal `3/4` denote the exact same value with no special-casing in the
;; front end. A negative literal `-3/4` desugars to `(Rational -3 4)` (or equivalently the unary-minus
;; operator on `(Rational 3 4)`); the sign-normalisation in the ctor makes those agree. The literal
;; needs no `from-int`: an integer literal `5` stays an Int, and `5/1` -> `(Rational 5 1)` if the
;; rational form is written explicitly.
(
    (import "std/core/errors")
    (import "std/core/protocols")

    ;; -- private Int helpers (see header: self-contained by rule) -----------------------------------

    ;; Int abs. NOT `Math.abs`: on JS Int is a BigInt, and `Math.abs(BigInt)` throws
    ;; "Cannot convert a BigInt to a number" -- measured. UNARY `(- n)`, not `(- 0 n)`: in the JS
    ;; module-inlining path a literal `0` is emitted as a Number, and `0 - bigint` promotes to Real
    ;; (D51 mix), so a large negative Int would lose its low bits; unary minus has no literal to
    ;; demote and stays an int64 negate (measured -- see `ipow`'s note).
    (fn iabs [n <- Int] -> Int (if (< n 0) (- n) n))

    ;; Euclid's gcd, always non-negative. `%` is int64 remainder on both backends. Operands are
    ;; abs'd first so a negative numerator (the only place a sign survives) does not leak a negative
    ;; gcd into the ctor's division.
    (fn gcd-int [a <- Int b <- Int] -> Int
        (mut x <- Int (iabs a))
        (mut y <- Int (iabs b))
        (while (!= y 0)
            ((let t (% x y)) (x := y) (y := t)))
        (return x))

    ;; Real -> Int, truncating toward zero. The narrowing is NAMED by the `-> Int` return type, the
    ;; same door math.lisp's `truncate` uses. It must go through `Math.trunc` and not `Math.floor`:
    ;; `Math.floor` is a typed Real->Real intrinsic, so `-> Int (Math.floor r)` trips LL0213
    ;; ("returns Real"), whereas `Math.trunc` is an untyped extern the return-check waves through.
    (fn itrunc [r <- Real] -> Int (return (Math.trunc r)))

    ;; Int floor of a Real, built from truncation because `Math.floor` cannot be narrowed (above).
    ;; Truncation and floor agree for non-negatives and differ by one for negative non-integers, which
    ;; is exactly the correction applied here. `from-real` needs true floor: a continued-fraction step
    ;; on a negative value with truncation would climb the wrong convergents.
    (fn ifloor [r <- Real] -> Int
        (let t (itrunc r))
        (if (and (< r 0.0) (!= (* 1.0 t) r)) (return (- t 1)))
        (return t))

    ;; Real abs, for the tolerance test in `near`. Local, so the module imports nothing.
    (fn rabs [r <- Real] -> Real (if (< r 0.0) (- 0.0 r) r))

    ;; -- the value type ----------------------------------------------------------------------------

    (defclass Rational :implements Formattable
        ;; `num`/`den` are ctor params AND the storage. `mut` because the ctor REWRITES them in place
        ;; while establishing the invariant (sign flip, then divide through by the gcd); after
        ;; construction they are never mutated again -- a Rational is a value.
        (mut :ctor num <- Int)
        (mut :ctor den <- Int)

        ;; Establish the invariant. This is the whole reason the type is trustworthy; see the header.
        (fn :ctor init [] -> Void
            ;; Loud, identical, before anything else can read den. See header on trap-vs-throw.
            (if (== this.den 0)
                (throw (new ArithmeticError "Rational: denominator is zero")))
            ;; Sign onto the numerator, so `den > 0` holds everywhere downstream. Unary `(- x)`, not
            ;; `(- 0 x)`: a literal `0` inlines to a Number on JS and would float a large Int (see
            ;; `iabs`); unary minus stays an int64 negate, so a wrapped denominator flips sign without
            ;; losing bits and both backends agree in the overflow regime too.
            (if (< this.den 0)
                ((this.num := (- this.num))
                 (this.den := (- this.den))))
            ;; Reduce. gcd(0, den) = den, so 0/5 collapses to 0/1 -- the unique zero -- without a
            ;; special case. Guard `> 1` only to skip the divides when already reduced.
            (let g (gcd-int this.num this.den))
            (if (> g 1)
                ((this.num := (/ this.num g))
                 (this.den := (/ this.den g))))
            ;; Canonicalise NEGATIVE ZERO. A zero numerator that passed through a negation becomes the
            ;; Number -0 on the JS backend, and -0 is NOT the canonical zero: `str` renders it "-0" and
            ;; `numer` hands back -0, while C (int64, which has no signed zero) prints "0". Measured
            ;; divergence on an ordinary in-range value -- e.g. (Rational 0 -5) hits the sign flip
            ;; above, (- r) / (r.neg) on a zero pass `(- 0)` into the ctor, and 0 * (negative) reaches
            ;; it through `*`. All three break the header's "unique zero" / "sign-free print" invariant
            ;; on one backend only. Re-stamping the literal 0 is a no-op on C (no -0 to fix) and, unlike
            ;; the sign flip's `(- 0)`, cannot float a large Int here because the value is exactly zero.
            (if (== this.num 0)
                (this.num := 0)))

        ;; -- projections ---------------------------------------------------------------------------

        (fn numer [] -> Int (return this.num))
        (fn denom [] -> Int (return this.den))

        (fn is-zero [] -> Boolean (return (== this.num 0)))
        ;; den is always 1 for an integer BECAUSE of reduction: 4/2 is stored 2/1. This would be a lie
        ;; without the ctor invariant.
        (fn is-integer [] -> Boolean (return (== this.den 1)))

        ;; Exact value as a Real. At least one operand is promoted to Real (`* 1.0`) so this is REAL
        ;; division, not D49d integer division -- `(/ this.num this.den)` on two Ints would floor.
        ;; Lossy for numerators beyond 2^53 (Real's integer range); the fraction itself stays exact.
        (fn to-real [] -> Real
            (return (/ (* 1.0 this.num) (* 1.0 this.den))))

        ;; n/d, or just n when the denominator is 1. Integer rendering is possible only because
        ;; reduction guarantees den = 1 names an integer.
        (fn str [] -> String
            (if (== this.den 1)
                (return f"{this.num}")
                (return f"{this.num}/{this.den}")))

        ;; D88: `format` is what the floor's display path calls, so `1/2` PRINTS as `1/2` rather than
        ;; as `Rational{:num 1 :den 2}`. That matters more than it looks: a numeric LITERAL that does
        ;; not render as itself reads like a leaked implementation detail. Declared as a bare method
        ;; rather than `:implements Formattable` for the reason `std/time/calendar` gives at its own
        ;; `format` -- `(x :of SomeInterface)` answers false on both backends today, so the interface
        ;; declaration would buy nothing and would cost this module its "no import" property.
        (fn format [] -> String (return (this.str)))

        ;; -- field operators: + - * / and unary - (D57's admitted set) -----------------------------

        ;; Knuth TAOCP 4.5.1 rational addition: divide through gcd(b,d) so the denominator product
        ;; b*d is never formed at full width. The `d1 = 1` fast path is the common case (coprime
        ;; denominators) and skips the second gcd.
        (fn :operator + [o <- Rational] -> Rational
            (let d1 (gcd-int this.den o.den))
            (if (== d1 1)
                (return (Rational (+ (* this.num o.den) (* o.num this.den))
                                  (* this.den o.den))))
            (let t (+ (* this.num (/ o.den d1)) (* o.num (/ this.den d1))))
            (let d2 (gcd-int t d1))
            (return (Rational (/ t d2)
                              (* (/ this.den d1) (/ o.den d2)))))

        ;; a/b - c/d, the same overflow-delaying shape as `+` with c negated. Written out rather than
        ;; `(+ this (- o))` only to avoid minting the intermediate negated Rational.
        (fn :operator - [o <- Rational] -> Rational
            (let d1 (gcd-int this.den o.den))
            (if (== d1 1)
                (return (Rational (- (* this.num o.den) (* o.num this.den))
                                  (* this.den o.den))))
            (let t (- (* this.num (/ o.den d1)) (* o.num (/ this.den d1))))
            (let d2 (gcd-int t d1))
            (return (Rational (/ t d2)
                              (* (/ this.den d1) (/ o.den d2)))))

        ;; Cross-reduce before multiplying (Knuth 4.5.1): cancel gcd(a,d) and gcd(c,b) so the products
        ;; are the smallest the reduced result permits. gcd-int abs's internally, so a negative num is
        ;; handled and the sign rides through to the ctor.
        (fn :operator * [o <- Rational] -> Rational
            (let g1 (gcd-int this.num o.den))
            (let g2 (gcd-int o.num this.den))
            (return (Rational (* (/ this.num g1) (/ o.num g2))
                              (* (/ this.den g2) (/ o.den g1)))))

        ;; (a/b)/(c/d) = (a*d)/(b*c), guarded and cross-reduced. `o.num = 0` is caught HERE, before the
        ;; ctor would see a zero denominator, so the message names division. A negative c lands on the
        ;; denominator and the ctor moves the sign.
        (fn :operator / [o <- Rational] -> Rational
            (if (== o.num 0)
                (throw (new ArithmeticError "Rational: division by zero")))
            (let g1 (gcd-int this.num o.num))
            (let g2 (gcd-int this.den o.den))
            (return (Rational (* (/ this.num g1) (/ o.den g2))
                              (* (/ this.den g2) (/ o.num g1)))))

        ;; Unary minus: the 0-parameter method form (D57). Sign lives on num, so this is a num negate;
        ;; den stays positive, invariant preserved with no re-reduction needed.
        (fn :operator - [] -> Rational
            (return (Rational (- this.num) this.den)))

        ;; -- named operations D57 keeps ASCII (not in the field-operator five) ----------------------

        (fn neg [] -> Rational (return (Rational (- this.num) this.den)))

        ;; 1/(a/b) = b/a. The reciprocal of zero is thrown, not trapped -- `this.num = 0` would reach
        ;; the ctor as a zero denominator, but guarding here names the operation.
        (fn recip [] -> Rational
            (if (== this.num 0)
                (throw (new ArithmeticError "Rational: reciprocal of zero")))
            (return (Rational this.den this.num)))

        ;; Integer power, negative exponents included. n < 0 reciprocates the result, so 0^negative
        ;; throws (num^|n| = 0 becomes a denominator). Base is already reduced, so num^k and den^k stay
        ;; coprime and the final ctor re-checks rather than reduces. Overflow WRAPS at high powers
        ;; (2^63 is reached by roughly the 63rd power of 2/1) with no trap (D51) -- which is why a
        ;; LINEAR loop is acceptable: the result overflows int64 long before |n| is large enough for
        ;; O(|n|)-vs-O(log|n|) to matter.
        ;;
        ;; Two workarounds are load-bearing here, both MEASURED, both compiler gaps reported rather
        ;; than fixed (this file may not touch the compiler):
        ;;
        ;;   * Named `ipow`, not `pow`. A method named `pow` collides with the floor function `pow`
        ;;     (Math.pow): when the receiver is an inline-constructed temporary, `((Rational 2 3).pow 3)`
        ;;     emits `new Rational(2,3).__ll_inlined_pow_1(3)` on JS -- resolving the member to the
        ;;     inlined GLOBAL floor `pow` -- and throws "not a function", while C dispatches the method
        ;;     and prints 8/27. `ipow` is the ruling's own spelling and dodges the collision.
        ;;
        ;;   * Square-and-multiply was REJECTED for a linear loop. The log-time form needs `(/ e 2)` and
        ;;     `(% e 2)`, and the JS module-inlining path emits an imported method's integer literals as
        ;;     Number, not BigInt (measured: the inlined `init` emits `_2d(0, this.num)`, no `n` suffix).
        ;;     A Number `2` makes `e/2` a MIXED op that D51's `__ll_mix` promotes to Real -- so `3/2`
        ;;     is `1.5` on JS and `1` on C, and `(2/3)^3` came out `2/3`. The +,-,*,/ operators are
        ;;     immune because every division there is by a gcd that EXACTLY divides, so Real and int64
        ;;     agree; `e/2` is the one truncating division, and the linear loop has none.
        ;;
        ;; The accumulators rn/rd are SEEDED FROM THE FIELDS (base^1), not from a literal `1`: a literal
        ;; `1` inlines to a Number, and Number * BigInt promotes the product to Real, so the numerator
        ;; would compute in DOUBLE precision. Seeding from `this.num` removes that particular demotion.
        ;;
        ;; HONEST LIMIT, re-measured (was overstated before -- do not trust the old "both backends wrap
        ;; identically" line, it is FALSE in this build): seeding from the field does NOT buy
        ;; cross-backend agreement once a result leaves int64. The JS Int representation is itself
        ;; inconsistent in the overflow regime -- `(Rational 3037000500 1).ipow 2` yields the
        ;; BigInt-exact `9223372037000250000` on JS (and, in other inlining contexts, the double
        ;; `9223372037000249344`), while C int64-wraps to `-9223372036709301616`. JS never reproduces
        ;; C's wrap here. So OVERFLOW RESULTS ARE NOT BYTE-IDENTICAL across backends today; that is a
        ;; compiler-side Int-emission gap, REPORTED not fixed here. Within int64 range every operation in
        ;; this type is measured identical on both backends -- that is the actual contract, and overflow
        ;; is the documented ceiling above, not a supported range. The loop runs |n|-1 times because one
        ;; factor is already in place. `e` is only a counter, so its Real drift from `(- e 1)` is
        ;; harmless (no truncation).
        (fn ipow [n <- Int] -> Rational
            (if (== n 0) (return (Rational 1 1)))
            (mut e <- Int (iabs n))
            (mut rn <- Int this.num)
            (mut rd <- Int this.den)
            (while (> e 1)
                ((rn := (* rn this.num))
                 (rd := (* rd this.den))
                 (e := (- e 1))))
            (if (< n 0)
                (return (Rational rd rn))
                (return (Rational rn rd))))

        ;; -- ordering and equality (a total order genuinely exists, so cmp/lt are honest) -----------

        ;; -1 / 0 / 1. Both denominators are positive (invariant), so the sign of a*d - c*b is the sign
        ;; of the difference and no sign bookkeeping is needed. The cross-products a*d and c*b can
        ;; OVERFLOW when the terms are large (each near 2^63): the comparison then wraps and can answer
        ;; wrongly, with no trap. Exact whenever |num|*|other den| stays under 2^63; an overflow-proof
        ;; comparison would run the Euclidean/continued-fraction algorithm and is deferred as it is not
        ;; needed for the ranges this type is used in.
        (fn cmp [o <- Rational] -> Int
            (let l (* this.num o.den))
            (let r (* o.num this.den))
            (if (< l r) (return -1))
            (if (> l r) (return 1))
            (return 0))

        (fn lt [o <- Rational] -> Boolean (return (< (this.cmp o) 0)))
        (fn le [o <- Rational] -> Boolean (return (<= (this.cmp o) 0)))
        (fn gt [o <- Rational] -> Boolean (return (> (this.cmp o) 0)))
        (fn ge [o <- Rational] -> Boolean (return (>= (this.cmp o) 0)))

        ;; Exact equality is FIELD equality, and that is only correct because of the canonical form:
        ;; 2/4 and 1/2 are the same stored pair, so `==` on the fields is exact with no cross-multiply
        ;; and no overflow. This is the measured-safe replacement D57 mandates for the refused `==`
        ;; operator.
        (fn eq [o <- Rational] -> Boolean
            (return (and (== this.num o.num) (== this.den o.den))))

        ;; Tolerant equality, for callers comparing a Rational against a value that came from Real
        ;; arithmetic. Difference is taken EXACTLY (via `-`) and then measured, so there is no
        ;; cancellation from converting both sides to Real first.
        (fn near [o <- Rational tol <- Real] -> Boolean
            (let d (- this o))
            (return (< (rabs (d.to-real)) tol)))

        ;; -- notation -- OPTIONAL U+2000+ glyph synonyms, one-line delegates (D57) -------------------
        ;;
        ;; Each is a member method delegating to its ASCII twin -- the ONLY channel D57 measured as
        ;; byte-safe across backends (a glyph in operator/head position is dead or diverges). ASCII is
        ;; the graded, greppable spelling; these earn their keep only by the call sites in
        ;; examples/40-math that exercise them on both backends. Delete this whole section and the
        ;; module is still complete. `recip` uses U+207B U+00B9 (superscript minus + superscript one):
        ;; a TWO-codepoint identifier, so it escapes the Latin-1 single-glyph mangling collision D57
        ;; bans (its JS encoding "207bb9" is not a writable ASCII name -- leading digit).
        (fn ⁻¹ [] -> Rational (return (this.recip)))
        (fn ≈ [o <- Rational tol <- Real] -> Boolean (return (this.near o tol))))

    ;; -- constructions the class ctor does not cover -----------------------------------------------

    ;; From an Int: n/1, already canonical.
    (fn from-int [n <- Int] -> Rational (return (Rational n 1)))

    ;; From a Real, by continued-fraction convergents. Returns the fraction p/q with the SMALLEST
    ;; denominator whose value is within `tol` of x -- the Stern-Brocot / best-rational-approximation
    ;; result, not a fixed-denominator round. Each convergent h_i/k_i is built from the standard
    ;; recurrence h_i = a_i*h_{i-1} + h_{i-2} (same for k), and iteration stops as soon as the
    ;; convergent is within tol or the fractional part collapses (an exactly-representable x).
    ;;
    ;; Tolerance: `tol` is an ABSOLUTE bound on |p/q - x|. An irrational x (or one whose exact
    ;; denominator exceeds int64) yields the best approximation reached before the 64-step cap; a cap,
    ;; not unbounded, because k_i grows at least like the Fibonacci numbers and would overflow int64
    ;; within ~90 steps regardless. Degrades for |x| beyond ~2^53, where x itself is no longer an exact
    ;; Real and the first `ifloor` is already wrong.
    (fn from-real [x <- Real tol <- Real] -> Rational
        (mut h0 <- Int 1)   ; h_{i-1}, seeded h_{-1} = 1
        (mut h1 <- Int 0)   ; h_{i-2}, seeded h_{-2} = 0
        (mut k0 <- Int 0)   ; k_{i-1}, seeded k_{-1} = 0
        (mut k1 <- Int 1)   ; k_{i-2}, seeded k_{-2} = 1
        (mut xr <- Real x)
        (mut i <- Int 0)
        (while (< i 64)
            ((let a (ifloor xr))
             (let h2 (+ (* a h0) h1))
             (let k2 (+ (* a k0) k1))
             (h1 := h0) (h0 := h2)
             (k1 := k0) (k0 := k2)
             (let approx (/ (* 1.0 h0) (* 1.0 k0)))
             (if (< (rabs (- approx x)) tol)
                 (return (Rational h0 k0)))
             (let frac (- xr (* 1.0 a)))
             ;; Exactly representable: the expansion terminated. Stop before dividing by ~0.
             (if (< (rabs frac) 1.0e-15)
                 (return (Rational h0 k0)))
             (xr := (/ 1.0 frac))
             (i := (+ i 1))))
        (return (Rational h0 k0)))

    ;; D88/N3 -- PROMOTION. An `:implicit` defcast is how l-lang declares "this converts to that", and
    ;; the checker now asks it at operator operands too, so `(+ 1 1/2)` works: `Int` has no `+` taking
    ;; a Rational, `Rational` does, and this says an Int can become one.
    ;;
    ;; `n/1` is exact and needs no reduction -- gcd(n, 1) = 1 -- so the ctor's invariant holds trivially
    ;; and the conversion is lossless in the direction that matters. The reverse (Rational -> Int) is
    ;; deliberately NOT declared: it would silently truncate, and a promotion that loses information is
    ;; how a numeric tower stops being trustworthy.
    (defcast :implicit [n <- Int] -> Rational (Rational n 1))

    (export Rational from-int from-real)
)

;; ADVERSARIAL: a numeric-tower literal is an ordinary CONSTRUCTION, and it needs no import (D88).
;;
;; `1/2` and `3+4i` lexed and parsed for years and then dead-ended: `ELL0106 'fraction-number'` on C,
;; `ELL0100 visitFractionNumber is not implemented` on JS. The tokens existed, the AST nodes existed,
;; the HIR carried them as literals, a `FractionHasZeroDenominator` validation rule was written -- and
;; `std/math/rational` and `std/math/complex` were sitting there complete, with operator overloads.
;; Nothing joined the two halves. The roadmap's own signature failure mode: written, never wired.
;;
;; THE LOWERING IS A DESUGAR, exactly as `(lo .. hi)` -> `(Range lo hi nil true)` already is:
;;
;;     1/2   ->  (Rational 1 2)
;;     3+4i  ->  (Complex 3.0 4.0)
;;
;; So there is NO backend work: both backends already construct these types and dispatch their
;; operators, which is how the frozen JS backend (D66) gains the feature for free.
;;
;; THE IMPORT IS IMPLIED, and that is a ruling rather than a convenience. Writing `1/2` IS the request
;; for `std/math` -- the user never typed the name `Rational`, so there would be nothing to warn about
;; and no remedy to offer. `Context.injectSyntaxModules` sees the literal node and injects, which is
;; why this file imports nothing. The stdlib does NOT go ambient: with no literal anywhere, a bare
;; `Rational` is still `LL0210 'Rational' is not defined`, and a bare name that resolves only because
;; some literal pulled the module in is `LL0245` (pinned in `test:diagnostics`, both directions).
;;
;; WHY IT DESUGARS IN `DesugarAstVisitor` AND NOT IN `AstBuilder`: `Context.injectPrelude` runs after
;; parse and before the symbols stage, and decides by LOOKING FOR THESE LITERAL NODES. Rewriting them
;; at parse time would erase the evidence the injector reads, and `Rational` would be undefined.
(
    ;; -- a fraction prints as itself ---------------------------------------------------------------
    ;;
    ;; Not `Rational{:num 1 :den 2}`. Both types implement `Formattable`, which the floor's display
    ;; path dispatches on (`ll_is_type(v, "Formattable")`) -- a numeric literal that does not render
    ;; like a number reads as a leaked implementation detail.

    (console.log "half:      " 1/2)

    ;; REDUCED at construction, by the ctor's gcd invariant -- so `4/8` and `1/2` are the same value
    ;; and print the same. This is the property that makes `Rational` worth having over a pair.
    (console.log "reduced:   " 4/8)

    ;; A denominator of 1 renders as the integer, which is why exactness is visible rather than noisy.
    (console.log "whole:     " 6/3)

    ;; -- exact arithmetic, which is the whole point of ruling `1/2` a Rational ----------------------
    ;;
    ;; 1/2 + 1/3 = 3/6 + 2/6 = 5/6 EXACTLY. As Reals this would be 0.8333333333333333 and the
    ;; round-trip would not be exact -- that is the difference the ruling buys.

    (console.log "sum:       " (+ 1/2 1/3))
    (console.log "product:   " (* 1/2 2/3))
    (console.log "difference:" (- 3/4 1/4))

    ;; -- complex literals --------------------------------------------------------------------------
    ;;
    ;; `3+4i` is ONE token, so it is one literal rather than `3 + 4i`. Decomposing it into an addition
    ;; needs Int/Real -> Complex promotion, which is a later round; the token is what makes the common
    ;; spelling work today.

    (console.log "cplx:      " 3+4i)

    ;; (2+3i)(1-1i) = 2 - 2i + 3i - 3i^2 = 2 + i + 3 = 5 + 1i. Hand-computed, then checked -- the
    ;; multiply is the operation where a sign error in the imaginary term hides easily.
    (console.log "cplx prod: " (* 2+3i 1-1i))
    (console.log "cplx sum:  " (+ 1+2i 3+4i))
)

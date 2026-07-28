;; ADVERSARIAL: an operand PROMOTES through an `:implicit` defcast (D88/N3).
;;
;; `1/2` was a value you could bind and not add to. `(+ 1 1/2)` was `ELL0106 arith-on-int/obj`: the
;; operator lookup asks the LEFT operand for the overload, `Int` has no `+` taking a Rational, and the
;; one that exists lives on `Rational`. A numeric type you cannot mix with an integer literal is not
;; worth shipping -- so promotion is not an extra on top of the tower, it IS the tower.
;;
;; NOT A NEW MECHANISM. `:implicit` defcast (D46/B-3) has always been the declaration for "this
;; converts to that"; it was consulted for ASSIGNMENT and never at an operand position. So a declared
;; conversion worked for `(let r <- Rational 1)` and was ignored by `(+ 1 r)` -- the same relation,
;; honoured in one place and not the other. This asks it in both.
;;
;; BOTH DIRECTIONS, and the second is the one that bit. Left-owns-the-operator already type-checked,
;; because `isAssignable` consults implicit casts when matching the parameter -- but the backend then
;; emitted a `c-cast int -> obj` that has no lowering. The checker said the program was valid and the
;; emitter could not produce it. Both stages consult the same declaration now.
;;
;; ONE HOP, inherited from `hasImplicitCast`. `Int -> Complex` is its own declaration and is never
;; reached as `Int -> Real -> Complex`. A chain would make the promotion order depend on which
;; conversions happen to be declared, which is the ambiguity a tower exists to remove.
;;
;; AND NOTHING PROMOTES DOWNWARD. `Rational -> Int` and `Complex -> Real` are deliberately NOT
;; declared: each would silently drop information, and a promotion that loses part of the value is how
;; a numeric tower stops being trustworthy.
(
    (import "std/math/constants")

    ;; -- Int into Rational -------------------------------------------------------------------------
    ;;
    ;; 1 + 1/2 = 2/2 + 1/2 = 3/2, exactly. The Int becomes `1/1` and the ordinary Rational `+` runs.

    (console.log "int + rat: " (+ 1 1/2))
    (console.log "int * rat: " (* 3 1/3))
    (console.log "int - rat: " (- 2 1/4))

    ;; THE MIRROR: the overload is the LEFT's here, and the RIGHT is what needs converting. Same
    ;; declaration, opposite operand -- and this is the direction that type-checked while refusing to
    ;; emit.
    (console.log "rat + int: " (+ 1/2 1))
    (console.log "rat / int: " (/ 3/2 3))

    ;; -- into Complex, from both Int and Real ------------------------------------------------------
    ;;
    ;; Two separate declarations, because the hop is never chained. If `Int -> Complex` were reached
    ;; through `Real`, deleting the Real conversion would silently change what the Int one means.

    (console.log "int + cplx:" (+ 3 4i))
    (console.log "real + cplx:" (+ 3.0 4i))

    ;; The motivating example, in the form the lexer actually allows: `E-6j` is ONE identifier, because
    ;; `-` is a kebab-case identifier character. Prefix `(- E 6j)` is the spelling, and it is exactly
    ;; a Real promoted into a Complex.
    (console.log "E - 6j:    " (- E 6j))

    ;; -- the guard: promotion ADDS assignability, it does not open a hole --------------------------
    ;;
    ;; `(- 3 "s")` must still be `LL0204 Operator '-' is not defined for Int and String`. It is pinned
    ;; in `test:diagnostics` rather than here, since this file has to run to completion. The check
    ;; that belongs here is the one below: a type with NO declared conversion still refuses.

    ;; Rational and Complex have no conversion between them in either direction, so mixing them is
    ;; still an error -- promotion follows the declarations and invents nothing.
    (console.log "done")
)

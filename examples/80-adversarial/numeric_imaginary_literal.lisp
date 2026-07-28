;; ADVERSARIAL: `4i` is an imaginary literal (D88).
;;
;; `3+4i` was one monolithic token, so the BARE imaginary -- the form you write when scaling, or when
;; the real part is a name -- had no spelling at all.
;;
;; IT REUSES THE COMPLEX NODE. `4i` builds a `complex-number` with a zero real part, so it rides the
;; desugar `3+4i` already uses and needs no AST type, no HIR change, and no backend work of its own.
;;
;; RULING: hex/octal/binary take NO postfix, ever. That falls out of token ORDER rather than a check --
;; Hex/Binary/Octal are matched before `ImaginaryNumber`, so `0xFFi` is the hex number `0xFF` followed
;; by the identifier `i` and dies as `LL0210 'i' is not defined`, rather than silently becoming an
;; imaginary hex.
;;
;; AND `[ij]`, NOT `[ijIJ]`: capital `I` is `std/math/complex`'s exported unit-imaginary CONSTANT. A
;; postfix that also matched `I` would make one character mean two things.
;;
;; NOT REACHABLE, and worth writing down because it was proposed: `E-6j` does NOT lex as
;; `E - 6j`. `-` is an identifier character (kebab-case), so `E-6j` is ONE identifier. The prefix form
;; `(- E 6j)` is the spelling, and it needs promotion (a later round) since `E` is a Real.
(
    ;; -- the literal -------------------------------------------------------------------------------

    (console.log "4i:    " 4i)
    (console.log "4.5j:  " 4.5j)

    ;; Both spellings are the same value -- `j` is the engineering convention and costs nothing to
    ;; accept, since neither letter can begin a decimal literal.
    (console.log "i == j:" (== 2i 2j))

    ;; Separators and exponents come along, because the pattern is the decimal one with a suffix.
    (console.log "sep:   " 1_000i)
    (console.log "exp:   " 1e3i)

    ;; -- arithmetic --------------------------------------------------------------------------------
    ;;
    ;; 2i + 3i = 5i, and (2i)(3i) = 6i^2 = -6 -- a REAL result from two imaginary operands, which is
    ;; the case that would expose a multiply that just multiplied components.

    (console.log "sum:   " (+ 2i 3i))
    (console.log "prod:  " (* 2i 3i))

    ;; A full complex built from its parts, pinning that the bare imaginary and the `a+bi` token agree.
    (console.log "agree: " (== (+ 3.0+0.0i 4i) 3+4i))
)

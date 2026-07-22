;; ADVERSARIAL (parity guard -- C-correct, JS-wrong): `Int` WRAPS at 64 bits (D51).
;;
;; D51 does not merely say Int is 64-bit; it says it is a WRAPPING two's-complement integer, which is
;; why C compiles with `-fwrapv` rather than leaving signed overflow to be undefined. On JS the
;; normalisation is `BigInt.asIntN(64, ...)` after each operation.
;;
;; Wrapping is a decision, not an accident: the alternative -- trapping, or promoting to a bignum --
;; would make `Int` a different type on the native endgame than it is on the transient backend, which
;; is the divergence the whole floor exists to prevent.
;;
;; EXPECTED == golden. ACTUAL under JS today: every line prints a rounded f64, and the wraparound does
;; not happen at all because a double has no 64-bit boundary to wrap at.
(
    (let MAX 9223372036854775807)
    (let MIN -9223372036854775808)

    (console.log "MAX:      " MAX)
    (console.log "MIN:      " MIN)

    ;; The wrap itself, in both directions.
    (console.log "MAX+1:    " (+ MAX 1))
    (console.log "MIN-1:    " (- MIN 1))

    ;; Multiplication wraps too, and is where an accidental f64 would be most obviously wrong.
    (console.log "MAX*2:    " (* MAX 2))
)

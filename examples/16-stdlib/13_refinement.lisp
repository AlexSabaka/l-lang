;; `:satisfies` refinements (D46 amend) -- NOMINAL newtypes. A refined deftype is a DISTINCT type
;; (identified by NAME), so two types with the same base + bounds are still different -- that is the
;; units pattern (a Kelvin is not a Meter). It is laid out as its base (base layout) and widens to the
;; base for arithmetic. An Int newtype's range is CHECKED at a value's boundary into it (P3c-1b-ii): an
;; out-of-range value PANICS (a contract violation is a bug, not a catchable error -- so these values
;; are all in range). Open-ended bounds work too: `(0 ..)` is "0 and up".
(
    (deftype uint8  <- Int  :satisfies (0 .. 255))   ;; a bounded integer
    (deftype Kelvin <- Real :satisfies (0 ..))       ;; open-ended: absolute zero and up

    ;; Int flows into the distinct uint8 newtype; uint8 widens back to Int for arithmetic.
    (let x <- uint8 200)
    (let y <- uint8 (+ x 55))
    (console.log "uint8:" x y)

    ;; Real flows into the distinct Kelvin newtype -- a different type from a bare Real, by name.
    (let k <- Kelvin 273)
    (console.log "kelvin:" k)
)

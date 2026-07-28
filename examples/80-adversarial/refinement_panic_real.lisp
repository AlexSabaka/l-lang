;; A Real refined newtype's sad path. The interesting part is that the MESSAGE agrees across the two
;; backends: C prints the value with `%g`, which is what makes `1.5` there and `1.5` on JS rather
;; than the `1.500000` a `%f` would give -- so the one panic file grades both.
(
    (deftype Ratio <- Real :satisfies (0.0..1.0))

    ;; At the top of the range: fine, inclusive bounds.
    (let ok <- Ratio 1.0)
    (console.log "ok:" ok)

    ;; Past it.
    (let bad <- Ratio 1.5)
    (console.log "unreachable:" bad)
)

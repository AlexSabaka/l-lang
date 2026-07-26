;; The PARAMETER boundary's sad path (P3c-1c-ii). Before this, a refined newtype guarded `let` and
;; nothing else -- a function declaring `[x <- uint8]` took 300 without a murmur, which made the
;; whole guarantee a third true.
;;
;; The check is a PROLOGUE inside `scale`, not a wrap at the call site, so it fires for every caller
;; rather than only the ones a desugar-time signature lookup could have found.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))

    (fn scale [x <- uint8] -> Int (* x 2))

    ;; In range: the prologue passes and the body runs.
    (console.log "ok:" (scale 100))

    ;; Out of range: dies on ENTRY to scale, so the multiply never happens.
    (console.log "boom:" (scale 300))
)

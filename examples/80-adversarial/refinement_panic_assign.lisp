;; The ASSIGNMENT boundary's sad path (P3c-2b), local-variable form. The binding was created in
;; range and is re-assigned out of it -- which every other boundary check would have missed, because
;; they all key on an annotation written next to the value and an assignment target has none.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))

    (mut brightness <- uint8 10)

    ;; In range: assigned and read back.
    (brightness := 255)
    (console.log "ok:" brightness)

    ;; One past the top: dies at the assignment, so the old value is never overwritten.
    (brightness := 256)
    (console.log "unreachable:" brightness)
)

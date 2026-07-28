;; The ASSIGNMENT boundary's sad path (P3c-2b), FIELD form -- a distinct emitter path from assigning
;; a local, and the case that decided where this check lives: the target's type belongs to the field,
;; reached through the object, so it is only knowable after inference.
(
    (deftype uint8 <- Int :satisfies (0..255))

    (defclass Lamp (mut :ctor level <- uint8))
    (let lamp (Lamp 5))

    ;; In range.
    (lamp.level := 255)
    (console.log "ok:" lamp.level)

    ;; Out of range: dies at the store, leaving the field as it was.
    (lamp.level := 256)
    (console.log "unreachable:" lamp.level)
)

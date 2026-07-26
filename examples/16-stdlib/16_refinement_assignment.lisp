;; The ASSIGNMENT boundary of a `:satisfies` refinement (D46 amend, P3c-2b) -- the last unguarded
;; write. Every other boundary has the annotation written next to the value; an assignment TARGET has
;; no annotation at all, so its type comes off the type channel after inference. That is why this
;; check lives at the HIR coercion point rather than in the desugar with the binding guards.
;;
;; One hook covers a local, a field and an index target, because all three resolve the same way.
;; Every value here is in range; the sad paths live in 80-adversarial/.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))
    (deftype Level <- Int :satisfies (1 ..))          ;; open-ended: 1 and up

    ;; A local `mut`.
    (mut brightness <- uint8 10)
    (brightness := 200)
    (console.log "local:" brightness)

    ;; A FIELD -- the target's type is the field's, reached through the object.
    (defclass Lamp (mut :ctor level <- uint8))
    (let lamp (Lamp 5))
    (lamp.level := 255)
    (console.log "field:" lamp.level)

    ;; An open-ended bound is still checked on the side that is closed.
    (mut depth <- Level 1)
    (depth := 99)
    (console.log "open-ended:" depth)

    ;; The refined value widens to its base for arithmetic, as ever.
    (console.log "widened:" (+ brightness 1))
)

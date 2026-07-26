;; The RETURN boundary's sad path (P3c-1c-ii), in its harder form: an IMPLICIT tail return, with no
;; `return` written anywhere. The two return forms are materialized in different places -- an explicit
;; `(return e)` is a list form in the desugar, while the tail only becomes one much later in HIR
;; lowering -- so the check has to be placed by the same rule codegen uses for the implicit return,
;; not by a second rule invented for refinements.
;;
;; Here the tail is an `if`, so the check lands on each BRANCH rather than around the `if`.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))

    (fn pick [big <- Boolean] -> uint8 (if big 999 5))

    ;; The in-range branch returns normally.
    (console.log "ok:" (pick false))

    ;; The other branch violates the range on its way out.
    (console.log "boom:" (pick true))
)

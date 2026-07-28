;; The FIELD-INIT boundary's sad path (P3c-1c-iii), in its harder form: the violated field is declared
;; on the PARENT and the value is passed to the CHILD's constructor.
;;
;; Nothing here reasons about argument positions. The parent's own synthesized `:ctor` check runs when
;; the child's constructor calls `super`, so an inherited refined field is guarded by the class that
;; declared it -- which is also why a cross-module parent needs no special handling.
(
    (deftype uint8 <- Int :satisfies (0..255))

    (defclass Base (let :ctor v <- uint8))
    (defclass Derived :extends Base (let :ctor tag <- String))

    ;; At the top of the range: constructs fine.
    (let ok (Derived 255 "fine"))
    (console.log "ok:" ok.v)

    ;; One past it: dies during construction, before anything is bound.
    (let boom (Derived 256 "nope"))
    (console.log "unreachable:" boom.v)
)

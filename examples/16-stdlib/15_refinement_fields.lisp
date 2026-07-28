;; The FIELD-INIT boundary of a `:satisfies` refinement (D46 amend, P3c-1c-iii). A `:ctor` field takes
;; its value from a constructor argument, so there is no annotated initializer to check -- it was the
;; last place a value could enter a refined newtype unexamined.
;;
;; The check rides a synthesized `:ctor` METHOD, which both backends already invoke after the field
;; stores. That is what makes inheritance work without any positional reasoning: every class checks
;; its OWN fields, and a parent's are checked by the parent's own method, reached through `super`.
;;
;; Every value here is in range; the sad path lives in 80-adversarial/.
(
    (deftype uint8 <- Int :satisfies (0..255))

    ;; A class `:ctor` field.
    (defclass Pixel (let :ctor level <- uint8))
    (let p (Pixel 200))
    (console.log "class:" p.level)

    ;; A struct `:ctor` field -- same mechanism.
    (defstruct Point (mut :ctor x <- uint8))
    (let pt (Point 12))
    (console.log "struct:" pt.x)

    ;; INHERITED: `v` is declared on the parent, so constructing the CHILD still checks it.
    (defclass Base (let :ctor v <- uint8))
    (defclass Derived :extends Base (let :ctor tag <- String))
    (let d (Derived 5 "hi"))
    (console.log "inherited:" d.v d.tag)

    ;; A field with a WRITTEN initializer needs none of that -- it is an ordinary annotated binding,
    ;; and has been checked since P3c-1b-ii.
    (defclass WithDefault (mut fixed <- uint8 42))
    (let w (WithDefault))
    (console.log "initializer:" w.fixed)
)

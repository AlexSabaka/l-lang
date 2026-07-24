;; `:satisfies` value refinements (D46 amend) -- the GRAMMAR foundation. A refined deftype
;; `(deftype uint8 <- Int :satisfies (0 .. 255))` is a distinct newtype the compiler will lay out and
;; check at its boundaries (init / cast / coercion). Boundary-check ENFORCEMENT is the next increment;
;; until it lands a refined type resolves as its base, so in-range values flow through as that base.
;; This guards that the `:satisfies` grammar parses and compiles end-to-end on both backends.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))

    (let a <- uint8 0)
    (let b <- uint8 200)
    (let c <- uint8 (+ b 55))
    (console.log "a b c:" a b c)

    ;; a refined type is usable wherever its base Int is
    (console.log "sum:" (+ (+ a b) c))
)

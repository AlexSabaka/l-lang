;; Reading ATTRIBUTES back out of the reflection graph (D72).
;;
;; 08 shows that attributes attach and cost nothing at run time. This is the half that makes them
;; worth attaching: the annotation and its arguments are readable from `std/llang/reflect`, on both
;; backends, which is the thing an annotation is FOR.
;;
;; The arguments must be literals. An attribute is data, and data that has to be evaluated to be read
;; is not data -- it is a decorator wearing the wrong hat. That restriction is what lets the whole
;; thing be a row in a table the C backend already emits, with no evaluator anywhere in sight.
(
    (import "std/llang/reflect")

    (defattribute docstring [text <- String])
    (defattribute since [major <- Int minor <- Int])
    (defattribute stable [flag <- Boolean])
    (defattribute deprecated [])

    (fn :public :docstring["adds two numbers"] :since[1 4] :stable[#t] :deprecated
        add [a <- Int b <- Int] -> Int (+ a b))

    (defclass :docstring["a widget with a size"] Widget
        (let :ctor size <- Int))

    (fn bare [] -> Int (return 0))

    (let t (type-by-name "add"))

    ;; Attributes sit alongside the builtins in the one modifier list, in the order written...
    (console.log "all:" (modifier-names t))

    ;; ...and come apart by role.
    (console.log "attributes:" (attribute-names t))
    (console.log "decorators:" (decorators t))

    ;; Arguments, by attribute name. Every literal kind survives the round trip to both backends.
    (console.log "string:" (attribute-args t "docstring"))
    (console.log "two ints:" (attribute-args t "since"))
    (console.log "boolean:" (attribute-args t "stable"))

    ;; A MARKER attribute has no arguments by design, so an empty vector is the right answer -- and it
    ;; is also what an absent attribute answers, which is why `has-attribute` exists to tell them apart.
    (console.log "marker args:" (attribute-args t "deprecated"))
    (console.log "marker present:" (has-attribute t "deprecated"))
    (console.log "absent:" (has-attribute t "nonexistent"))
    (console.log "absent args:" (attribute-args t "nonexistent"))

    ;; A class carries them the same way -- one field on the shared declaration entry.
    (console.log "class:" (attribute-args (type-by-name "Widget") "docstring"))

    ;; And a declaration with no modifiers at all answers empty rather than raising -- the entry has
    ;; no `modifiers` key whatsoever, so this is the totality the module promises, not a lucky read.
    (console.log "none:" (attribute-names (type-by-name "bare")))

    (console.log "run:" (add 2 3))
)

;; ADVERSARIAL: A CONTAINER LITERAL THAT REACHES CODEGEN AS RAW AST MUST BOX ITS ELEMENTS.
;;
;; `resolveAstExpr`'s `vector` case declared its element type as `C_VALUE` and then handed the
;; elements over UNBOXED. The HIR path never had this -- `InsertCoercions` boxes for it -- but the
;; RAW-AST re-drive gets none of that, and a method call on a literal receiver takes the raw path.
;;
;;     ([1 2 3].reduce …)   ->   ll_vec_of(3, (ll_value[]){INT64_C(1), INT64_C(2), INT64_C(3)})
;;
;; AND `ll_value`'S FIRST MEMBER IS THE TAG. A scalar brace-initializes it, so those three elements
;; decoded as tag 1, tag 2, tag 3 -- `Int 0`, `Real 0.0`, `Bool false`. **Zero diagnostics at `-Wall
;; -Wextra`**: it is legal C that means something else entirely. It surfaced as `TypeError: expected
;; a number` from folding the Bool, which points at the reduction rather than at the literal.
;;
;; THE VALUES BELOW ARE 1, 2, 3 ON PURPOSE. They are the tags `LL_INT`, `LL_REAL`, `LL_BOOL`, so the
;; miscompile is maximally visible here and would be invisible in a vector of, say, `[100 200]` --
;; both of which are past the tag range and decode as nil. A guard written with round numbers would
;; have passed.
(
    ;; A native METHOD on a literal receiver -- the shape that reported the bug. `reduce` folds every
    ;; element, so one mis-tagged member is enough to change the answer or trap.
    (console.log "reduce :" ([1 2 3].reduce (fn [acc x] (+ acc x)) 0))

    ;; `join` READS every element instead of folding it, so it catches a mis-tag that arithmetic
    ;; happens to survive: under the bug this printed the decoded tags, not the numbers.
    (console.log "join   :" ([1 2 3].join "-"))

    ;; A method that RETURNS a container, so the elements make a second trip.
    (console.log "map    :" ([1 2 3].map (fn [x] (* x 10))))

    ;; A literal as an ARGUMENT to an untyped parameter -- boxed at a different site, and correct
    ;; before this fix. Kept as the control: it says the defect was the literal's ELEMENTS, not
    ;; literals in general.
    (fn second [xs] (return xs[1]))
    (console.log "as arg :" (second [7 8 9]))

    ;; The MAP twin. Its values were unboxed too and every consumer reached so far happened to coerce
    ;; on the way in -- a class-field default stores into a `value` slot -- which is the kind of luck
    ;; that stops being lucky.
    (fn at [m] (return m["b"]))
    (console.log "map arg:" (at {"a" 1 "b" 2}))
    (console.log "done")
)

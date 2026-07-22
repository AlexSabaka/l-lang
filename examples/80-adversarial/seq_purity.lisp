;; CONFORMANCE guard: `std/seq` returns NEW sequences and never mutates its argument (D53, Fg-3).
;;
;; `std/seq` is the EAGER, collection-last, functional-order half of D33's split. `(reverse xs)` in
;; that idiom answers with a reversed sequence; it does not reach into `xs`. It did reach into `xs`:
;; the body was `(coll.reverse)`, and `Array.prototype.reverse` reverses IN PLACE and returns the same
;; array -- as does C's `ll_vec_reverse`, which returns its own argument. So both backends agreed, and
;; both were wrong in the same direction. `(let b (reverse a))` left `a` reversed too, and `a` and `b`
;; were the SAME array, so a later write through one was visible through the other.
;;
;; Nothing caught it because the corpus's one call site -- `16-stdlib/test_stdlib.lisp` -- reverses a
;; literal it never looks at again. A guard has to hold the source and print it AFTERWARDS, which is
;; what the paired "original:" lines below are for.
;;
;; `flatten` is here too, for a different reason: it is ONE level (JS `flat(1)`), which means it has
;; to distinguish an array element from a non-array one. It now does that with `(x :of Array)` -- the
;; D41 runtime type test, which both backends already implement and conformance-test -- rather than
;; with a native `.flat`, which C's `ll_dyn_method` never had. `[[1 2] 3 [4]]` is the discriminating
;; case: a flatten that assumed every element was an array would fail on the bare `3`, and one that
;; recursed would flatten `[[1] 2]` all the way down.
(
    (import "std/seq")

    (let a [3 1 2])

    (console.log "reverse:  " (reverse a))
    (console.log "original: " a)

    (console.log "sorted:   " (sort a))
    (console.log "original: " a)

    (console.log "flat:     " (flatten [[1 2] [3 4]]))
    (console.log "mixed:    " (flatten [[1 2] 3 [4]]))
    (console.log "one-deep: " (flatten [[[1] 2] [3]]))

    (console.log "map:      " (map (fn [x] (* x 10)) a))
    (console.log "filter:   " (filter (fn [x] (> x 1)) a))
    (console.log "reduce:   " (reduce (fn [acc x] (+ acc x)) 0 a))
    (console.log "original: " a)
)

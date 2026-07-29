;; ADVERSARIAL: A DESTRUCTURING PATTERN NESTS, AND ITS TAIL IS A VALUE.
;;
;; The C lowering handled exactly one shape per pattern kind -- a vector of `identifier-pattern`
;; leaves, a map of `identifier-pattern` leaves -- and refused anything else BY NAME:
;;
;;     (let [first second ...rest] xs)          ELL0106 destructuring-element:rest-pattern
;;     (let {:user {:name n}} data)             ELL0106 destructuring-element:map-pattern
;;
;; Both are the same absence: each arm bound leaves and had no way to DESCEND. Nesting is one
;; recursive call, and the tail is one clamped slice.
;;
;; THE SUBJECT IS STILL EVALUATED ONCE PER LEVEL, which is the property the temporary exists for --
;; `(let [a b] (next-pair))` must not call `next-pair` twice, and the nested form must not re-read its
;; sub-subject once per leaf beneath it. Every level binds a temp and recurses into that.
(
    ;; -- the TAIL ------------------------------------------------------------------------------------
    ;;
    ;; `...rest` is a real vector: indexable, and it has a length. Binding it as "the remaining
    ;; elements" and binding it as "something that prints like a vector" are different claims, so the
    ;; length is asserted rather than only the printed form.

    (let [a b ...rest] [1 2 3 4 5])
    (console.log "tail        :" a b rest rest.length rest[0])

    ;; A pattern LONGER than its subject: the fixed elements are bounds-guarded to nil, and the tail
    ;; CLAMPS to empty rather than trapping. `ll_vec_slice` clamps by construction, which is the same
    ;; answer the guarded ternary beside it gives, and the same answer the oracle gives.
    (let [p q ...none] [7])
    (console.log "short       :" p q none none.length)

    ;; The tail taking exactly nothing, which is the boundary between the two lines above.
    (let [m ...tail] [9])
    (console.log "empty tail  :" m tail tail.length)

    ;; -- NESTING, in both directions -----------------------------------------------------------------

    (let data {:user {:name "Ada" :id 42} :tag "x"})
    (let {:user {:name uname :id uid} :tag t} data)
    (console.log "map in map  :" uname uid t)

    (let [[i j] [k l]] [[1 2] [3 4]])
    (console.log "vec in vec  :" i j k l)

    ;; A map pattern inside a vector pattern, which is the crossing case -- an arm that could descend
    ;; only into its own kind would pass both lines above and fail this one.
    (let [{:name n1} {:name n2}] [{:name "Ada"} {:name "Bob"}])
    (console.log "map in vec  :" n1 n2)

    ;; And a tail beneath a nesting level, so the two features are exercised together rather than only
    ;; side by side.
    (let {:items [head ...more]} {:items [10 20 30]})
    (console.log "tail in map :" head more)
    (console.log "done")
)

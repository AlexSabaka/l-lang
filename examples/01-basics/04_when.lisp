;; When Guard - Simple Conditional
;;
;; This example demonstrates:
;; - when guard syntax (simple if without else)
;; - :then keyword for result value

(
    ;; 1. Basic when - returns nil if condition false
    (let value 42)
    (let result (when (> value 0) :then "positive"))
    (console.log "Result 1:" result)

    ;; 2. When with expression
    (let message (when (== value 42) :then '"The answer to everything"))
    (console.log "Result 2:" message)

    ;; 3. When has NO else -- a false condition yields nil.
    (let x 10)
    (let nothing (when (< x 0) :then "negative"))
    (console.log "Nothing:" nothing)

    ;; So a condition CHAIN wants `if`, which does have an else. (This is what `when` is for:
    ;; a guard you run when a condition holds, not a way to pick between branches.)
    (let category (if (< x 0)
        "negative"
        (if (== x 0)
            "zero"
            "positive")))

    (console.log "Category:" category)

    ;; 4. When for side effects
    (mut counter 0)
    (when (> counter 0) :then (
        (console.log "Counter is positive!")
        (counter := (+ counter 10))
    ))

    (counter := 5)
    (when (> counter 0) :then (
        (console.log "Counter is positive!")
        (counter := (+ counter 10))
    ))
    
    (console.log "Final counter:" counter)
)

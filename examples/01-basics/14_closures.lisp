;; Closures & Higher-Order Functions
;;
;; This example demonstrates:
;; - Functions returning functions
;; - Lexical scope capture
;; - Currying patterns

(
    ;; 1. Simple closure - function captures outer variable
    (fn make-multiplier [factor <- Int] (
        (fn multiply [x <- Int] (
            (return (* x factor))
        ))
        (return multiply)
    ))

    (let times-3 (make-multiplier 3))
    (let times-5 (make-multiplier 5))

    (console.log "5 * 3 =" (times-3 5))
    (console.log "5 * 5 =" (times-5 5))

    ;; 2. Function that returns another function
    (fn make-adder [n <- Int] (
        (fn adder [x <- Int] (+ x n))
        (return adder)
    ))

    (let add-10 (make-adder 10))
    (let add-20 (make-adder 20))

    (console.log "15 + 10 =" (add-10 15))
    (console.log "15 + 20 =" (add-20 15))

    ;; 3. Higher-order function taking function as parameter
    (fn apply-twice [f] (
        (fn result [x] (
            (return (f (f x)))
        ))
        (return result)
    ))

    (let square-twice (apply-twice (fn [x] (* x x))))
    (console.log "2^4 =" (square-twice 2))  ;; (2^2)^2 = 16

    ;; 4. Function composition
    (fn compose [f g] (
        (fn composed [x] (
            (return (f (g x)))
        ))
        (return composed)
    ))

    (fn double [x] (* x 2))
    (fn add-one [x] (+ x 1))

    (let double-then-add (compose add-one double))
    (console.log "(5 * 2) + 1 =" (double-then-add 5))

    ;; 5. Closure with mutable state
    (fn make-counter [] (
        (let count <- Int 0)
        (fn increment [] (
            (count := (+ count 1))
            (return count)
        ))
        (return increment)
    ))

    (let counter (make-counter))
    (console.log "Count:" (counter))   ;; 1
    (console.log "Count:" (counter))   ;; 2
    (console.log "Count:" (counter))   ;; 3
)

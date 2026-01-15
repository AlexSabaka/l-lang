;; Recursion Patterns
;;
;; This example demonstrates:
;; - Simple recursion (factorial)
;; - Linear recursion (fibonacci)
;; - Tree recursion
;; - Mutual recursion

(
    ;; 1. Tail-recursive factorial
    (fn factorial [n <- Int] -> Int (
        (if (<= n 1)
            (return 1)
            (return (* n (factorial (- n 1)))))
    ))

    (console.log "5! =" (factorial 5))
    (console.log "10! =" (factorial 10))

    ;; 2. Fibonacci (naive recursive)
    (fn fib [n <- Int] -> Int (
        (if (<= n 1)
            (return n)
            (return (+ (fib (- n 1)) (fib (- n 2)))))
    ))

    (console.log "Fib(5) =" (fib 5))
    (console.log "Fib(6) =" (fib 6))
    (console.log "Fib(7) =" (fib 7))

    ;; 3. Sum all elements in array (linear recursion)
    (fn sum-array [arr <- Int[] idx <- Int] -> Int (
        (if (>= idx (arr.length))
            (return 0)
            (return (+ arr[idx] (sum-array arr (+ idx 1)))))
    ))

    (let nums [1 2 3 4 5])
    (console.log "Sum of array:" (sum-array nums 0))

    ;; 4. Tree structure recursion
    (fn tree-sum [tree] -> Int (
        (if (== (type tree) Number)
            (return tree)
            (if (== (type tree) Array) (
                (let total <- Int 0)
                (for :each node :from tree :then (
                    (total := (+ total (tree-sum node)))
                ))
                (return total))
                (return 0)
            )
        )
    ))

    (let nested-tree [1 [2 3] [[4 5] 6]])
    (console.log "Tree sum:" (tree-sum nested-tree))

    ;; 5. Power function (recursive)
    (fn power [base <- Int exp <- Int] -> Int (
        (if (== exp 0)
            (return 1)
            (if (== exp 1)
                (return base)
                (return (* base (power base (- exp 1))))))
    ))

    (console.log "2^5 =" (power 2 5))
    (console.log "3^4 =" (power 3 4))
)

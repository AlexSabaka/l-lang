(
    ;; Timing modifier that measures function execution time
    (defmodifier timed [])
    
    ;; Slow fibonacci function (without memoization)
    (fn :timed fib-slow [n <- Int] -> Int
        (match n {
            0 => 1
            1 => 1
            _ => (+ (fib-slow (- n 1)) (fib-slow (- n 2)))
        })
    )
    
    ;; Fast function for comparison
    (fn :timed simple-add [a <- Int, b <- Int] -> Int
        (+ a b)
    )
    
    (console.log "Testing timing modifier:")
    (console.log "Fast function result:" (simple-add 10 20))
    (console.log "Slow fibonacci fib(10):" (fib-slow 10))
    (console.log "Another call fib(8):" (fib-slow 8))
)
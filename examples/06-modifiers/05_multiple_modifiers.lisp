(
    ;; Multiple modifiers on the same function
    (defmodifier logged [])
    (defmodifier memoized [])
    (defmodifier timed [])
    
    ;; Function with multiple modifiers (logged, memoized, and timed)
    (fn :logged :memoized :timed fibonacci [n <- Int] -> Int
        (match n {
            0 => 1
            1 => 1  
            _ => (+ (fibonacci (- n 1)) (fibonacci (- n 2)))
        })
    )
    
    ;; Function with just logging for comparison
    (fn :logged simple-fib [n <- Int] -> Int
        (match n {
            0 => 1
            1 => 1
            _ => (+ (simple-fib (- n 1)) (simple-fib (- n 2)))
        })
    )
    
    (console.log "Testing multiple modifiers:")
    (console.log "First call fib(8) - should time, log, and memoize:")
    (console.log (fibonacci 8))
    
    (console.log "\nSecond call fib(8) - should hit cache:")  
    (console.log (fibonacci 8))
    
    (console.log "\nComparison - simple-fib(8) without memoization:")
    (console.log (simple-fib 8))
)
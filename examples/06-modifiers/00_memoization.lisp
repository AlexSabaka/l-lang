(
    ;; Define a memoization modifier
    (defmodifier memoized [])
    
    ;; Memoized fibonacci function using the modifier
    (fn :memoized fib [n <- Int] -> Int
        (match n {
            0 => 1
            1 => 1
            _ => (+ (fib (- n 1)) (fib (- n 2)))
        })
    )

    (console.log "fib(10):" (fib 10))
    (console.log "fib(10):" (fib 10))
    (console.log "fib(10):" (fib 10))
    (console.log "fib(22):" (fib 22))
    (console.log "fib(22):" (fib 22))
)
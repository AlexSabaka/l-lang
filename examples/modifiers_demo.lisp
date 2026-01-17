(
    ;; Basic modifiers demo using working patterns
    
    ;; Define simple modifiers
    (defmodifier memoized [])
    (defmodifier cached [])
    
    ;; Function with :memoized modifier
    (fn :memoized calculate-expensive [n <- Int] -> Int (
        (console.log "Computing" n "...")
        (if (<= n 1) 
            (return n)
            (return (+ (calculate-expensive (- n 1)) (calculate-expensive (- n 2))))
        )
    ))

    ;; Simple fibonacci without modifiers
    (fn fibonacci-normal [n <- Int] -> Int (
        (if (<= n 1)
            (return n)
            (return (+ (fibonacci-normal (- n 1)) (fibonacci-normal (- n 2))))
        )
    ))

    ;; Function with memoized modifier  
    (fn :memoized compute-factorial [n <- Int] -> Int (
        (console.log "Computing factorial of" n)
        (if (<= n 1)
            (return 1)
            (return (* n (compute-factorial (- n 1))))
        )
    ))

    (console.log "=== Memoized function test ===")
    (console.log "Fib 5:" (calculate-expensive 5))

    (console.log "=== Normal function test ===")
    (console.log "Normal Fib 5:" (fibonacci-normal 5))

    (console.log "=== Factorial test ===")
    (console.log "5! =" (compute-factorial 5))
)
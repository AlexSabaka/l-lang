(
    ;; Manual memoization implementation for now
    ;; (defmodifier will be implemented in future)
    
    ;; Global memo cache for fibonacci
    (let fib-memo {})
    
    ;; Memoized fibonacci function
    (fn fib [n <- Int] -> Int
        ;; Check if result is cached. `get` is the TOTAL form and answers nil for an absent key;
        ;; `fib-memo[n]` is PARTIAL and would throw, since indexing asserts the key is there (D9).
        (let cached (get fib-memo n))
        (if (!= cached nil) (return cached))
        
        ;; Calculate result based on input
        (let result (match n {
            0 => 1
            1 => 1
            _ => (+ (fib (- n 1)) (fib (- n 2)))
        }))
        
        ;; Cache and return result
        (fib-memo[n] := result)
        result
    )

    (console.log "fib(10):" (fib 10))
    (console.log "fib(10):" (fib 10))
    (console.log "fib(10):" (fib 10))
    (console.log "fib(22):" (fib 22))
    (console.log "fib(22):" (fib 22))
)
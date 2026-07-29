(
    ;; Base Fibonacci function without memoization
    (fn fib-base [n <- Int] -> Int
        (if (<= n 1) (return n))
        (+ (fib-base (- n 1)) (fib-base (- n 2)))
    )

    ;; Global memo cache
    (let memo {})

    ;; Memoized Fibonacci function using simple statements.
    ;;
    ;; `(get memo n)` -- NOT `memo[n]` -- for the "is it cached?" question. The indexer is PARTIAL
    ;; (D9): an absent key THROWS, because asking `c[k]` means asserting the thing is there. Asking
    ;; whether it is there at all is what the TOTAL form, `get`, is for -- and it answers nil.
    (fn fib [n <- Int] -> Int
        (let cached (get memo n))
        (if (!= cached nil) (return cached))
        (if (<= n 1) 
            (memo[n] := n)
            (memo[n] := (+ (fib (- n 1)) (fib (- n 2))))
        )
        memo[n]
    )

    (console.log f"Fib 10: {(fib 10)}") 
    (console.log f"Fib 33: {(fib 33)}") 
    (console.log f"Fib 33: {(fib 33)}") 
    (console.log f"Fib 10 again: {(fib 10)}") 

    (console.log f"Fib Base 10: {(fib-base 10)}") 
    (console.log f"Fib Base 31: {(fib-base 31)}") 
    (console.log f"Fib Base 10 again: {(fib-base 10)}") 
)
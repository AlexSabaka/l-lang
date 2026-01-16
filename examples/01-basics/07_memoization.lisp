(
    ;; Base Fibonacci function without memoization
    (fn fib-base [n <- Int] -> Int
        (if (<= n 1) (return n))
        (+ (fib-base (- n 1)) (fib-base (- n 2)))
    )

    ;; Global memo cache
    (let memo {})

    ;; Memoized Fibonacci function using simple statements
    (fn fib [n <- Int] -> Int
        (if (!= memo[n] undefined) (return memo[n]))
        (if (<= n 1) 
            (memo[n] := n)
            (memo[n] := (+ (fib (- n 1)) (fib (- n 2))))
        )
        memo[n]
    )

    (console.log '"Fib 10: {(fib 10)}") 
    (console.log '"Fib 33: {(fib 33)}") 
    (console.log '"Fib 33: {(fib 33)}") 
    (console.log '"Fib 10 again: {(fib 10)}") 

    (console.log '"Fib Base 10: {(fib-base 10)}") 
    (console.log '"Fib Base 31: {(fib-base 31)}") 
    (console.log '"Fib Base 10 again: {(fib-base 10)}") 
)
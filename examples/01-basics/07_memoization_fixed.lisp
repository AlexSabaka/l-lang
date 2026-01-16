(
    ;; Example of custom :memoized modifier with manual memoization for comparison

    ;; Traditional approach: manual memoization using higher-order functions
    (fn fib-base [n <- Int] -> Int
        (if (<= n 1) (return n))
        (let result (+ (fib-base (- n 1)) (fib-base (- n 2))))
        (return result)
    )

    ;; High-order function generator for manual memoization
    (fn make-memoized [base-fn]
        (let memo {})
        (fn memoized-wrapper [n <- Int] -> Int
            ;; Check cache
            (if (!= memo[n] undefined)
                (return memo[n])
            )
            (let result (base-fn n))
            ;; Cache result
            (memo[n] := result)
            (return result)
        )
        (return memoized-wrapper)
    )

    ;; Future: Using custom :memoized modifier (placeholder for now)
    ;; This demonstrates the intended syntax once modifier evaluation is implemented
    (fn :memoized fib-auto [n <- Int] -> Int
        (if (<= n 1) n
            (+ (fib-auto (- n 1)) (fib-auto (- n 2))))
    )

    ;; Create manually memoized version
    (let fib-manual (make-memoized fib-base))

    ;; Test manual memoization
    (console.log "=== Manual Memoization Test ===")
    (console.log '"Manual Fib 10: {(fib-manual 10)}") ;; Calc
    (console.log '"Manual Fib 15: {(fib-manual 15)}") ;; Calc
    (console.log '"Manual Fib 15: {(fib-manual 15)}") ;; Should be instant (cached)
    (console.log '"Manual Fib 10 again: {(fib-manual 10)}") ;; Should be instant (cached)

    ;; Test base function (no memoization)
    (console.log "=== Base Function Test (No Memoization) ===")
    (console.log '"Base Fib 10: {(fib-base 10)}") ;; Always calculates
    (console.log '"Base Fib 15: {(fib-base 15)}") ;; Always calculates

    ;; Test automatic memoization (will work once modifier evaluation is implemented)
    (console.log "=== Automatic Memoization Test ===")
    (console.log '"Auto Fib 10: {(fib-auto 10)}") ;; Will be memoized when :memoized is implemented
    (console.log '"Auto Fib 15: {(fib-auto 15)}") ;; Will be memoized when :memoized is implemented
)
(
    (fn fib-base [n]
        ;; Base cases
        (if (<= n 1) (return n))

        ;; Recurse
        (let result (+ (fib-base (- n 1)) (fib-base (- n 2))))
        (return result)
    )

    ;; High-order function generator
    (fn make-fib []
        ;; 'memo' is captured in the closure
        (let memo {})

        (fn fib-inner [n]
            ;; Check cache
            (if (!= memo[n] undefined)
                (return memo[n])
            )

            (let result (fib-base n))

            ;; Cache result
            (memo[n] := result)
            (return result)
        )

        (return fib-inner)
    )

    (let fib (make-fib call))

    (std.console.log '"Fib 10: {(fib 10)}") ;; Calc
    (std.console.log '"Fib 33: {(fib 33)}") ;; Calc
    (std.console.log '"Fib 33: {(fib 33)}") ;; Should be instant (cached)
    (std.console.log '"Fib 10 again: {(fib 10)}") ;; Should be instant (cached)

    (std.console.log '"Fib Base 10: {(fib-base 10)}") ;; Calc
    (std.console.log '"Fib Base 31: {(fib-base 31)}") ;; Calc
    (std.console.log '"Fib Base 10 again: {(fib-base 10)}") ;; Calc
)
(
    ;; Demonstrate custom modifiers with the new syntax
    
    ;; Function with :memoized modifier (parsed but not yet evaluated)
    (fn :memoized calculate-expensive [n <- Int] -> Int
        (console.log '"Computing {n}...")
        (if (<= n 1) 
            n
            (+ (calculate-expensive (- n 1)) (calculate-expensive (- n 2)))
        )
    )

    ;; Function with parameterized modifier
    (fn :cached[size 100] fibonacci-cached [n <- Int] -> Int
        (if (<= n 1)
            (return n)
        )
        (+ (fibonacci-cached (- n 1)) (fibonacci-cached (- n 2)))
    )

    ;; Function with multiple modifiers
    (fn :public :memoized compute-factorial [n <- Int] -> Int
        (if (<= n 1)
            (return 1)
        )
        (* n (compute-factorial (- n 1)))
    )

    (console.log '"Memoized function test:")
    (console.log '"Fib 5: {(calculate-expensive 5)}")

    (console.log '"Cached function test:")
    (console.log '"Cached Fib 5: {(fibonacci-cached 5)}")

    (console.log '"Factorial test:")
    (console.log '"5! = {(compute-factorial 5)}")
)
(
    (import "01_lib_a.lisp")
    (import "01_lib_b.lisp")
    (import "01_lib_c.lisp")

    (log ":info" '"The secret A is {(secret-number-a)}")
    (log ":info" '"The secret B is {(secret-number-b)}")
    
    (let sum (calculate-lazy-sum 10 20))
    (log ":info" '"Lazy Sum: {(sum)}")

    (let prod (calculate-lazy-mult 10 20))
    (log ":info" '"Lazy Prod: {(prod)}")

    (log ":info" '"This is the main program done running." )
)
(
    (import "01_lib_c.lisp")

    (let secret-number-a 42)

    (fn calculate-lazy-sum [a b] 
        (return (+ a b)))
    
    ;; Should only run if NOT imported
    (log ":warning" f"Library A probably meant to be imported, not run directly! Secret is {(secret-number-a)}")

    ;; Export specific symbols
    (export secret-number-a)
    (export calculate-lazy-sum)
)
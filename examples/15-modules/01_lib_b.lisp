(
    (import "01_lib_c.lisp")

    (let secret-number-b 96)

    (fn calculate-lazy-mult [a b] 
        (return (* a b)))

    ;; Should only run if NOT imported
    (log ":warning" f"Library B probably meant to be imported, not run directly! Secret is {(secret-number-b)}")

    ;; Export specific symbols
    (export secret-number-b)
    (export calculate-lazy-mult)
)
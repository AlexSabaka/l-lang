(
    (fn error [msg <- String] -> Real (
        (console.log msg)
        (return NaN)
    ))

    (deftype Expr <- (Int | String | Expr)[])

    ;; A tiny Lisp interpreter that handles (+, -, *)
    (fn eval-expr [expr <- Expr] -> Real (return
        (match expr {
            ["+" a b] => (+ (eval-expr a) (eval-expr b))
            ["-" a b] => (- (eval-expr a) (eval-expr b))
            ["*" a b] => (* (eval-expr a) (eval-expr b))
            [op  _ _] => (error (+ "Unknown operator: " op))
            value     => (Number value)
        })
    ))

    (let program <- Expr ["+" 10 ["*" 5 ["-" 10 8]]])
    (console.log f"Result should be 20: {(eval-expr program)}")
)
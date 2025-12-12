(
    (fn error [msg] (
        (console.log msg)
        (return NaN)
    ))

    ;; A tiny Lisp interpreter that handles (+, -, *)
    (fn eval-expr [expr] (return
        (match expr {
            ["+" a b] => (+ (eval-expr a) (eval-expr b))
            ["-" a b] => (- (eval-expr a) (eval-expr b))
            ["*" a b] => (* (eval-expr a) (eval-expr b))
            [op  _ _] => (error "Unknown operator: " op)
            value     => (Number value)
        })
    ))

    (let program ["+" 10 ["*" 5 ["-" 10 8]]])
    (console.log '"Result should be 20: {(eval-expr program)}")
)
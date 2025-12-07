(
    ;; A tiny Lisp interpreter that handles (+, -, *)
    (fn eval-expr [expr] (
        (match expr {
            ;; Case: Number literal (Base case)
            val :is Number => val

            ;; Case: Addition (+ a b)
            ["+" a b] => (+ (eval-expr a) (eval-expr b))

            ;; Case: Subtraction (- a b)
            ["-" a b] => (- (eval-expr a) (eval-expr b))

            ;; Case: Multiplication (* a b)
            ["*" a b] => (* (eval-expr a) (eval-expr b))

            ;; Case: Nested list with unknown operator
            [op _ _] => (throw (+ "Unknown operator: " op))

            _ => 0
        })
    ))

    ;; Expression: (+ 10 (* 5 (- 10 8))) -> (+ 10 (* 5 2)) -> (+ 10 10) -> 20
    (let program ["+" 10 ["*" 5 ["-" 10 8]]])

    (std.console.log '"Result should be 20: {(eval-expr program)}")
)
;; RPN Calculator — Stacks, Matching and Error Handling
;;
;; This example demonstrates:
;; - `split` from std/string to tokenize the input
;; - a stack built from a plain vector (`push` / `pop`, `xs[0]` indexing)
;; - `match` on a token as an operator dispatch table
;; - `throw` + `catch ... :of Error` for the three failure paths:
;;   stack underflow, unknown token, and division by zero

(
    (import "std/io")
    (import "std/core/string")

    ;; Take one value off the stack. `pop` is typed as `Real?` because it
    ;; yields nothing on an empty vector, so we guard first and then read
    ;; the top through indexing, which is total.
    (fn pop-operand [stack <- Real[]] -> Real (
        (if (== stack.length 0)
            (throw (new Error "stack underflow")))
        (let top stack[(- stack.length 1)])
        (stack.pop)
        (return top)
    ))

    ;; Anything that is not an operator has to parse as a number;
    ;; if it does not, the token is junk.
    (fn parse-operand [tok <- String] -> Real (
        (let n (Number tok))
        (if (isNaN n)
            (throw (new Error (+ "unknown token: " tok))))
        (return n)
    ))

    ;; The arithmetic itself. Division by zero is rejected rather than
    ;; being allowed to produce Infinity.
    (fn apply-op [op <- String a <- Real b <- Real] -> Real (
        (if (== op "/")
            (if (== b 0)
                (throw (new Error "division by zero"))))
        (return (match op {
            "+" => (+ a b)
            "-" => (- a b)
            "*" => (* a b)
            "/" => (/ a b)
            _   => NaN
        }))
    ))

    ;; Pop two operands, apply, push the result back.
    (fn binary-step [stack <- Real[] op <- String] -> Void (
        (let b (pop-operand stack))  ;; RPN pops the RIGHT operand first
        (let a (pop-operand stack))
        (stack.push (apply-op op a b))
        (return nil)
    ))

    ;; `match` doubles as the dispatch table: operators fold the stack,
    ;; everything else is pushed as a literal.
    (fn eval-token [stack <- Real[] tok <- String] -> Void (
        (match tok {
            "+" => (binary-step stack tok)
            "-" => (binary-step stack tok)
            "*" => (binary-step stack tok)
            "/" => (binary-step stack tok)
            _   => (stack.push (parse-operand tok))
        })
        (return nil)
    ))

    ;; A well-formed expression consumes every token and leaves exactly
    ;; one value behind.
    (fn rpn-eval [source <- String] -> Real (
        (let stack [])
        (for :each tok :from (split (trim source) " ") :then (
            (eval-token stack tok)
        ))
        (if (!= stack.length 1)
            (throw (new Error (+ "malformed expression: " stack.length " values left"))))
        (return stack[0])
    ))

    ;; Driver: report the value, or the reason it could not be computed.
    (fn show [source <- String] -> Void (
        (try (
            (print "{0} => {1}" source (rpn-eval source))
        )
        catch e :of Error (
            (print "{0} !! {1}" source e.message)
        ))
        (return nil)
    ))

    (console.log "--- RPN Calculator ---")
    (show "3 4 + 2 *")
    (show "5 1 2 + 4 * + 3 -")
    (show "10 2 /")

    (console.log "--- Error Paths ---")
    (show "1 0 /")      ;; division by zero
    (show "1 +")        ;; stack underflow
    (show "2 3 %")      ;; unknown token
    (show "1 2 3 +")    ;; leftover operands
)

;; Function Type Signatures
;;
;; This example demonstrates:
;; - Function parameter type annotations
;; - Return type annotations
;; - Type checking across function calls

(
    ;; 1. Function with parameter and return types
    (fn add [a <- Int b <- Int] -> Int (
        (return (+ a b))
    ))

    ;; 2. Function with multiple parameter types
    (fn greet [name <- String age <- Int] -> String (
        (return '"Hello, {(name)}! You are {(age)} years old.")
    ))

    ;; 3. Function returning nothing (void)
    (fn print-value [x <- Int] -> Void (
        (console.log "Value:" x)
    ))

    ;; 4. Function with optional return statement
    ;; (implicit return of last expression)
    (fn square [x <- Int] (
        (* x x)
    ))

    ;; 5. Function accepting Any type
    (fn is-truthy [x <- Any] -> Boolean (
        (return (!= x nil))
    ))

    ;; 6. Function returning union type
    (fn parse-int [str <- String] -> Int | String (
        (let num (Number str))
        (if (isNaN num)
            (return str)
            (return num))
    ))

    ;; Test calls
    (console.log "5 + 3 =" (add 5 3))
    (console.log (greet "Sloth" 42))
    (print-value 100)
    (console.log "Square of 7 =" (square 7))
    (console.log "10 is truthy:" (is-truthy 10))
    (console.log "nil is truthy:" (is-truthy nil))
)

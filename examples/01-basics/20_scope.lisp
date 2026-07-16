;; Variable Scope & Shadowing
;;
;; This example demonstrates:
;; - Lexical scoping
;; - Variable shadowing
;; - Scope blocks
;; - Closure scope capture

(
    ;; 1. Global and function scope
    (console.log "--- Global and Function Scope ---")
    (let global-x 10)
    
    (fn test-scope [] -> nil (
        (let local-x 20)
        (console.log "Local x:" local-x)
        (console.log "Global x:" global-x)
    ))
    
    (test-scope)
    ;; local-x is not accessible here
    (console.log "Global x outside function:" global-x)

    ;; 2. Variable shadowing
    (console.log "--- Variable Shadowing ---")
    (let x 1)
    (console.log "Outer x:" x)
    
    (let inner-block (
        (let x 2)
        (console.log "Inner x (shadowed):" x)
        x  ;; Return inner x
    ))
    
    (console.log "Outer x (unchanged):" x)
    (console.log "Value from inner block:" inner-block)

    ;; 3. Shadowing in nested functions
    (console.log "--- Shadowing in Nested Functions ---")
    (let value 100)
    
    (fn outer [] -> Int (
        (let value 200)
        (fn inner [] -> Int (
            (let value 300)
            (return value)
        ))
        (let r1 (inner))
        (console.log "Inner returned:" r1)
        (console.log "Outer sees:" value)
        (return value)
    ))
    
    (let result (outer))
    (console.log "Global sees:" value)
    (console.log "Outer returned:" result)

    ;; 4. Block scope
    (console.log "--- Block Scope ---")
    (let count 0)
    
    (if true (
        (let count 1)
        (console.log "Inside if:" count)
    ))
    (console.log "After if:" count)
    
    (for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (
        (let count (+ count 10))
        (console.log "In loop, iteration count:" count)
    ))
    (console.log "After loop:" count)

    ;; 5. Loop variable scope
    (console.log "--- Loop Variable Scope ---")
    (let numbers [1 2 3 4 5])
    (for :each num :from numbers :then (
        (console.log "Loop num:" num)
    ))
    ;; num is not accessible outside loop

    ;; 6. Closure capturing variables
    (console.log "--- Closure Scope Capture ---")
    (let create-counter (
        (let count 0)
        (fn get-counter [] -> (fn [] -> Int) (
            (fn increment [] -> Int (
                (count := (+ count 1))
                (return count)
            ))
            (return increment)
        ))
        (get-counter)
    ))
    
    ;; Each call increments the same captured count
    (console.log "Count 1:" (create-counter))  ;; 1
    (console.log "Count 2:" (create-counter))  ;; 2
    (console.log "Count 3:" (create-counter))  ;; 3

    ;; 7. Multiple closures over same scope
    (console.log "--- Closures Sharing Scope ---")
    (let x 5)
    
    (fn make-functions [] -> [(fn [] -> Int) (fn [] -> Int)] (
        (let local 10)
        (fn get-x [] -> Int (return x))
        (fn get-local [] -> Int (return local))
        (return [get-x get-local])
    ))
    
    (let [f1 f2] (make-functions))
    (console.log "Global x via closure:" (f1))
    (console.log "Local via closure:" (f2))

    ;; 8. Parameter shadowing
    (console.log "--- Parameter Shadowing ---")
    (fn process [x <- Int] -> Int (
        (console.log "Parameter x:" x)
        (let x (* x 2))
        (console.log "Shadowed x:" x)
        (return x)
    ))
    (let result (process 5))
    (console.log "Result:" result)

    ;; 9. Scope with conditionals
    (console.log "--- Conditional Scope ---")
    (let test-value 0)
    
    (if (> test-value 0) (
        (let message "positive")
        (console.log "Value is:" message)
    ) (if (< test-value 0) (
        (let message "negative")
        (console.log "Value is:" message)
    ) (
        (let message "zero")
        (console.log "Value is:" message)
    )))

    ;; 10. Scope in match expressions
    (console.log "--- Match Scope ---")
    (let value "hello")
    
    (match value {
        "hello" => (
            (let greeting "Welcome!")
            (console.log greeting)
        )
        s :of String => (
            (let greeting "Unknown string")
            (console.log greeting ":" s)
        )
    })

    ;; 11. Immediate invocation with scope
    (console.log "--- IIFE Pattern ---")
    (let result (
        ;; Immediately invoked function expression
        (fn temp [] -> Int (
            (let local 42)
            (let doubled (* local 2))
            (return doubled)
        ))
        (temp)
    ))
    (console.log "Result from IIFE:" result)

    ;; 12. Scope leakage prevention
    (console.log "--- Scope Isolation ---")
    (let isolate-vars (
        ;; Variables defined here are isolated
        (let secret "hidden")
        (let public "visible")
        ;; Only return what we want exposed
        public
    ))
    (console.log "Exposed value:" isolate-vars)
    ;; secret is not accessible
)

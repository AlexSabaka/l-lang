;; Higher-Order Functions
;;
;; This example demonstrates:
;; - Functions as arguments
;; - Returning functions
;; - Function composition
;; - Map/filter/reduce patterns

(
    ;; 1. Function as parameter
    (console.log "--- Functions as Parameters ---")
    (fn apply-twice [f <- (fn [Int] -> Int) :x Int] -> Int (
        (let result1 (f x))
        (let result2 (f result1))
        (return result2)
    ))
    
    (fn double [n <- Int] -> Int (return (* n 2)))
    (let result (apply-twice double :x 3))
    (console.log "Apply double twice to 3:" result)  ;; (3 * 2) * 2 = 12

    ;; 2. Function returning function
    (console.log "--- Returning Functions ---")
    (fn make-multiplier [factor <- Int] -> (fn [Int] -> Int) (
        (fn multiply [x <- Int] -> Int (
            (return (* x factor))
        ))
        (return multiply)
    ))
    
    (let times3 (make-multiplier 3))
    (let times5 (make-multiplier 5))
    (console.log "3 * 4 =" (times3 4))
    (console.log "5 * 4 =" (times5 4))

    ;; 3. Array operations with functions
    (console.log "--- Array Operations ---")
    (fn map-array [arr <- [Int] :transform <- (fn [Int] -> Int)] -> [Int] (
        (let result [])
        (for :each item :from arr :then (
            (result.push (transform item))
        ))
        (return result)
    ))
    
    (fn square [n <- Int] -> Int (return (* n n)))
    (let numbers [1 2 3 4 5])
    (let squares (map-array numbers :transform square))
    (console.log "Squares:" squares)

    ;; 4. Filter function
    (console.log "--- Filter Pattern ---")
    (fn filter-array [arr <- [Int] :predicate <- (fn [Int] -> Bool)] -> [Int] (
        (let result [])
        (for :each item :from arr :then (
            (if (predicate item)
                (result.push item))
        ))
        (return result)
    ))
    
    (fn is-even [n <- Int] -> Bool (
        (return (== (% n 2) 0))
    ))
    (let filtered (filter-array numbers :predicate is-even))
    (console.log "Even numbers:" filtered)

    ;; 5. Reduce pattern
    (console.log "--- Reduce Pattern ---")
    (fn reduce-array [arr <- Int[]] :combine <- (fn [Int Int] -> Int) :initial <- Int] -> Int (
        (let accumulator initial)
        (for :each item :from arr :then (
            (accumulator := (combine accumulator item))
        ))
        (return accumulator)
    ))
    
    (fn add [a <- Int :b Int] -> Int (return (+ a b)))
    (fn multiply [a <- Int :b Int] -> Int (return (* a b)))
    
    (let sum (reduce-array numbers :combine add :initial 0))
    (let product (reduce-array numbers :combine multiply :initial 1))
    (console.log "Sum:" sum)
    (console.log "Product:" product)

    ;; 6. Function composition
    (console.log "--- Function Composition ---")
    (fn compose [f <- (fn [Int] -> Int) :g <- (fn [Int] -> Int)] -> (fn [Int] -> Int) (
        (fn composed [x <- Int] -> Int (
            (return (f (g x)))
        ))
        (return composed)
    ))
    
    (fn add-one [n <- Int] -> Int (return (+ n 1)))
    (fn times-two [n <- Int] -> Int (return (* n 2)))
    
    (let add-then-double (compose times-two add-one))
    (console.log "Compose: (x + 1) * 2 = " (add-then-double 5))  ;; (5 + 1) * 2 = 12

    ;; 7. Callback pattern
    (console.log "--- Callback Pattern ---")
    (fn process-data [data <- String :on-success <- (fn [String] -> nil) :on-error <- (fn [String] -> nil)] -> nil (
        (if (> data.length 0)
            (on-success (+ "Processed: " data))
            (on-error "Data is empty"))
    ))
    
    (fn handle-success [msg <- String] -> nil (
        (console.log "Success:" msg)
    ))
    (fn handle-error [msg <- String] -> nil (
        (console.log "Error:" msg)
    ))
    
    (process-data "hello" :on-success handle-success :on-error handle-error)
    (process-data "" :on-success handle-success :on-error handle-error)

    ;; 8. Pipeline with multiple operations
    (console.log "--- Pipeline Operations ---")
    (let data [1 2 3 4 5 6 7 8 9 10])
    
    ;; Filter evens, square them, sum them
    (let evens (filter-array data :predicate is-even))
    (console.log "Evens:" evens)
    
    (let squared (map-array evens :transform square))
    (console.log "Squared:" squared)
    
    (let total (reduce-array squared :combine add :initial 0))
    (console.log "Sum of squared evens:" total)
)

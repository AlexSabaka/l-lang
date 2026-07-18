;; For-Each Loops - Iteration
;;
;; This example demonstrates:
;; - for :each iteration over arrays
;; - Accessing loop variable
;; - Nested iterations

(
    ;; 1. Simple for-each over array
    (console.log "--- Iterate Array ---")
    (let fruits ["apple" "banana" "cherry"])
    (for :each item :from fruits :then (
        (console.log item)
    ))

    ;; 2. For-each with index-like behavior (manual)
    (console.log "--- Array with Index ---")
    (let colors ["red" "green" "blue"])
    (mut idx 0)
    (for :each color :from colors :then (
        (console.log '"Color {(idx)}: {(color)}")
        (idx := (+ idx 1))
    ))

    ;; 3. For-each over vector of numbers
    (console.log "--- Sum Numbers ---")
    (let numbers [10 20 30 40 50])
    (mut total 0)
    (for :each num :from numbers :then (
        (total := (+ total num))
    ))
    (console.log "Total:" total)

    ;; 4. For-each with complex objects
    (console.log "--- Process Users ---")
    (let users [
        { :name "Alice" :age 30 }
        { :name "Bob" :age 25 }
        { :name "Charlie" :age 35 }
    ])
    
    (for :each user :from users :then (
        (console.log '"Name: {(user.name)}, Age: {(user.age)}")
    ))

    ;; 5. Nested for-each
    (console.log "--- Matrix Elements ---")
    (let matrix [[1 2 3] [4 5 6] [7 8 9]])
    
    (for :each row :from matrix :then (
        (for :each elem :from row :then (
            (console.log elem)
        ))
    ))
)

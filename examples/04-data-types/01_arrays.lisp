;; Arrays & Vector Operations
;;
;; This example demonstrates:
;; - Array literals and indexing
;; - Array mutations
;; - Array operations (head, tail, etc.)
;; - Vector spreading

(
    ;; 1. Array literals and access
    (let numbers [10 20 30 40 50])
    (console.log "Array:" numbers)
    (console.log "First element:" numbers[0])
    (console.log "Last element:" numbers[(- numbers.length 1)])

    ;; 2. Array with mixed types
    (let mixed [1 "hello" 3.14 true nil])
    (console.log "Mixed array:" mixed)

    ;; 3. Nested arrays (matrix)
    (let matrix [[1 2 3] [4 5 6] [7 8 9]])
    (console.log "Matrix:" matrix)
    (console.log "Element [1][2]:" matrix[1][2])  ;; Should be 6

    ;; 4. Array mutation
    (let arr [1 2 3])
    (arr[0] := 100)
    (console.log "After mutation:" arr)

    ;; 5. Array operations (using standard library)
    (let items ["a" "b" "c" "d"])
    
    ;; Head - first element
    (let first (head items))
    (console.log "First:" first)
    
    ;; Length
    (console.log "Length:" items.length)

    ;; 6. Array iteration
    (console.log "--- Iterate Array ---")
    (for :each item :from numbers :then (
        (console.log item)
    ))

    ;; 7. Transform array (mapping logic)
    (let squared [])
    (for :each num :from [1 2 3 4 5] :then (
        (squared.push (* num num))
    ))
    (console.log "Squared:" squared)

    ;; 8. Filter array elements
    (let evens [])
    (for :each num :from [1 2 3 4 5 6 7 8] :then (
        (if (== (% num 2) 0)
            (evens.push num))
    ))
    (console.log "Even numbers:" evens)

    ;; 9. Array slicing (index range)
    (let full [0 1 2 3 4 5 6 7 8 9])
    (let slice (full.slice 2 5))  ;; Elements 2, 3, 4
    (console.log "Slice [2:5]:" slice)
)

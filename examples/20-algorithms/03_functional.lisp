(
    ;; 1. Map Implementation
    (fn map [arr func] (
        (let result [])
        (for :each item :from arr :then (
            (result.push (func item))
        ))
        (return result)
    ))

    ;; 2. Filter Implementation
    (fn filter [arr predicate] (
        (let result [])
        (for :each item :from arr :then (
            (if (predicate item)
                (result.push item))
        ))
        (return result)
    ))

    ;; 3. Reduce Implementation
    (fn reduce [arr func initial] (
        (mut acc initial)
        (for :each item :from arr :then (
            (acc := (func acc item))
        ))
        (return acc)
    ))

    ;; --- Test Usage ---

    (let numbers [1 2 3 4 5 6])

    ;; Anonymous function usage
    (let squares (map numbers (fn [x] (* x x))))
    (let evens (filter numbers (fn [x] (== (% x 2) 0))))
    (let sum (reduce numbers (fn [acc x] (+ acc x)) 0))

    (console.log f"Squares (should be [1, 4, 9, 16, 25, 36]): {(squares)}")
    (console.log f"Evens (should be [2, 4, 6]): {(evens)}")
    (console.log f"Sum (should be 21): {(sum)}")
)
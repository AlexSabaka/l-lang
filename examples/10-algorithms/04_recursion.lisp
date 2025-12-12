(
    ;; Testing if the compiler handles forward references or hoisting correctly
    
    (fn is-even [n] (
        (if (== n 0) (return true))
        (return (is-odd (- n 1))) ;; Calls function defined below
    ))

    (fn is-odd [n] (
        (if (== n 0) (return false))
        (return (is-even (- n 1))) ;; Calls function defined above
    ))

    (console.log '"10 is even? {(is-even 10)}")
    (console.log '"11 is even? {(is-even 11)}")


    (let numbers [1 2 3 4 5 6])

    (fn reduce-rec [arr func initial] (return 
        (if (empty arr)
            initial
            (reduce-rec (tail arr) func (func initial (head arr)))
        )
    ))

    (let sum (reduce-rec numbers (fn [acc x] (+ acc x)) 0))
    (console.log '"Sum (should be 21): {(sum)}")
)
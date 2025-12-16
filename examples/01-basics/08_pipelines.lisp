(
    ;; Helper functions
    (fn add [x <- Number y <- Number] -> Number (return (+ x y)))
    (fn sub [x <- Number y <- Number] -> Number (return (- x y)))
    (fn square [x] (return (* x x)))

    ;; 1. Left Carrying (Forward Pipe, Left Side Argument Placing)
    ;; 5 -> sub(7) -> square() -> result
    ;; result = square(add(sub(5, 7), 1))
    ;; Grammar: FunctionCarrying with "|>"
    (let result-a 
        (5 
         |> (sub 7)
         |> (add 1)
         |> square))
    
    (console.log '"Pipeline A Result (1): {(result-a)}")

    ;; 2. Right Carrying (Backward Pipe, Right Side Argument Placing)
    ;; 5 -> sub(7) -> square() -> result
    ;; result = square(add(1, sub(7, 5)))
    ;; Grammar: FunctionCarrying with "<|"
    (let result-b
        (5 <| (- 7) <| (+ 1) |> square))

    (console.log '"Pipeline B Result (9): {(result-b)}")

    ;; 3. Mixed with standard library methods (if shimmed) and mixed directions
        ;; .toUpperCase |>
    (let result-c-1
        ("hello"
            |> (fn [s] (return s.length))
            |> (/ 10)
            |> square))
    (console.log '"Pipeline C1 Result (0.25): {(result-c-1)}")

    (let result-c-2
        ("hello"
            |> (fn [s] (return s.length))
            |> (fn [x] (/ 10 x))
            |> square))
    (let result-c-3
        ("hello"
            |> .length
            <| (/ 10)
            |> square))
    (console.log '"Pipeline C2 Result (4): {(result-c-2)} == {(result-c-3)}")
)
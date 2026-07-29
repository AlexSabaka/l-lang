(
    ;; Helper functions
    (fn add [x <- Real y <- Real] -> Real (return (+ x y)))
    (fn sub [x <- Real y <- Real] -> Real (return (- x y)))
    (fn square [x <- Real] -> Real (return (* x x)))

    ;; 1. Left Carrying (Forward Pipe, Left Side Argument Placing)
    ;; 5 -> sub(7) -> square() -> result
    ;; result = square(add(sub(5, 7), 1))
    ;; Grammar: FunctionCarrying with "|>"
    (let result-a 
        (5 
         |> (sub 7)
         |> (add 1)
         |> square))
    
    (console.log f"Pipeline A Result (1): {(result-a)}")

    ;; 2. Right Carrying (Backward Pipe, Right Side Argument Placing)
    ;; 5 -> sub(7) -> square() -> result
    ;; result = square(add(1, sub(7, 5)))
    ;; Grammar: FunctionCarrying with "<|"
    (let result-b
        (5 <| (- 7) <| (+ 1) |> square))

    (console.log f"Pipeline B Result (9): {(result-b)}")

    ;; 3. Mixed with standard library methods (if shimmed) and mixed directions
        ;; .toUpperCase |>
    ;; `10.0` and not `10`, because this line wants a REAL quotient and says so in its own label.
    ;; `.length` is an Int (D52) and D49d makes `Int / Int` integer division, so `(/ 10)` here asks for
    ;; `5 / 10 == 0` -- which is what the statically-typed spelling of it has always answered on BOTH
    ;; backends. It printed 0.25 only through the pipeline, where the lambda erases the type and the
    ;; deprecated backend's `.length` is a host Number at run time while its own checker calls it Int.
    ;; The demonstration here is PIPELINES; relying on a lost type to get its advertised answer was
    ;; incidental, and `80-adversarial/int_division_erasure.lisp` is where that divergence is pinned.
    (let result-c-1
        ("hello"
            |> (fn [s] (return s.length))
            |> (/ 10.0)
            |> square))
    (console.log f"Pipeline C1 Result (0.25): {(result-c-1)}")

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
    (console.log f"Pipeline C2 Result (4): {(result-c-2)} == {(result-c-3)}")
)
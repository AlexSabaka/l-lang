(
    ;; Helper functions
    (fn add [x y] (return (+ x y)))
    (fn square [x] (return (* x x)))
    (fn to-string [x] (return (+ "" x)))

    ;; 1. Left Carrying (Forward Pipe)
    ;; Logic: 5 -> add(10) -> square() -> result
    ;; Grammar: FunctionCarrying with "|>"
    (let result-a 
        (5 
         |> (add 10) 
         |> square))
    
    (std.console.log '"Pipeline A Result (225): {(result-a)}")

    ;; 2. Right Carrying (Backward Pipe / Composition)
    ;; Logic: square(add(10, 5))
    ;; Grammar: FunctionCarrying with "<|"
    (let result-b
        (square <| (add 10) <| 5))

    (std.console.log '"Pipeline B Result (225): {(result-b)}")

    ;; 3. Mixed with standard library methods (if shimmed)
    ;; (let str-len ("hello" |> .length)) 
    ;; Note: Grammar supports member function carrying via "." identifier
)
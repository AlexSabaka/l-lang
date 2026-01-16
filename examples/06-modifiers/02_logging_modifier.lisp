(
    ;; Logging modifier that logs function calls and results
    (defmodifier logged [])
    
    ;; Simple math function with logging
    (fn :logged add [a <- Int, b <- Int] -> Int
        (+ a b)
    )
    
    ;; Simple double function with logging
    (fn :logged double [x <- Int] -> Int  
        (+ x x)
    )
    
    ;; Test the logged functions
    (console.log "Testing logged functions:")
    (console.log "5 + 3 =" (add 5 3))
    (console.log "double 7 =" (double 7))
    (console.log "2 + 8 =" (add 2 8))
)
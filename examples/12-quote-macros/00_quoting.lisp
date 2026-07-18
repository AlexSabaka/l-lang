(
    ;; A simple list of data
    (let simple-list '(1 2 3))
    
    ;; A quoted expression (code as data)
    ;; Should NOT execute strict math, but result in a list: ["+", 1, 2]
    (let expr '(+ 1 2))

    ;; Nested quoting
    (let logic 
        '(if (> x 10)
             (print "Big")
             (print "Small")))

    (console.log '"Simple List: {(simple-list)}")
    (console.log '"Expression structure: {(expr)}")
    (console.log '"First element of expr: {(head expr.nodes.nodes)}") ;; Should be "+"

    (let x 4)
    (console.log '"Expression structure: {(eval logic)}")
)
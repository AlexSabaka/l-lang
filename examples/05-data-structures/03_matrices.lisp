(
    ;; 1. Matrix Literal
    ;; Grammar: [ Expression, ... | Expression, ... ]
    (let identity-matrix 
        [ 1, 0, 0 
        | 0, 1, 0 
        | 0, 0, 1 ])

    (let matrix-2x2
        [ 10, 20
        | 30, 40 ])

    ;; 2. Accessing (Grammar has 'Indexer')
    ;; Note: Indexer rule supports [expr, expr] for multi-dimensional access
    (console.log '"Top Left: {(matrix-2x2[0, 0])}") 
    (console.log '"Bottom Right: {(matrix-2x2[1, 1])}")
) 
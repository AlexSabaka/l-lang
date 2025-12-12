(
    ;; 1. Union Types with various spacing (testing your new fix)
    (deftype StringOrInt  String|Number)      ;; Tight
    (deftype BoolOrNil    Boolean | Nil)      ;; Wide
    (deftype ComplexUnion String | Number | Boolean) ;; Multiple

    ;; 2. Function with complex typed params
    (fn messy-signature [
        x <- String | Number,
        y <- Boolean|Nil
    ] -> Array<String | Number> (
        (return [x y])
    ))

    ;; 3. Vector vs Matrix Ambiguity check
    ;; A vector containing an expression with a pipe operator (bitwise OR if you support it, or type union)
    ;; If the parser fails, it might think this is a matrix because of the '|'
    (let weird-vector [ [1 [2] []] 3 4 ]) 

    ;; 4. Matrix with excessive whitespace and comments
    (let spacious-matrix 
        [ 1   2   3
        | 4   5   6
        | 7   8   9 ]
    )

    ;; 5. Nested Lists with weird indentation
    (let weird-indent (
        list 
          1 
            2 
              (list 3 4)
    ))

    (console.log "If you see this, the parser survived.")
)
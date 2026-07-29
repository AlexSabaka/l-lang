(
    (defstruct Vector2
        (let :ctor x <- Real 0.0)
        (let :ctor y <- Real 0.0)

        (fn :operator + [other <- Vector2] -> Vector2
            (return (new Vector2 (+ this.x other.x) (+ this.y other.y)))
        )

        (fn :operator - [other <- Vector2] -> Vector2
            (return (new Vector2 (- this.x other.x) (- this.y other.y)))
        )

        (fn :operator * [scalar <- Real] -> Vector2
            (return (new Vector2 (* this.x scalar) (* this.y scalar)))
        )

        (fn :operator - [] -> Vector2
            (return (new Vector2 (- 0 this.x) (- 0 this.y)))
        )

        (fn :operator == [other <- Vector2] -> Boolean
             (return (if (== this.x other.x) (== this.y other.y) false))
        )
    )

    (let v1 (new Vector2 10 20))
    (let v2 (new Vector2 5 5))

    ;; Binary +
    (let v3 (+ v1 v2))
    (console.log f"v3: {(v3.x)}, {(v3.y)}") ;; Expected: 15, 25

    ;; Binary -
    (let v4 (- v1 v2))
    (console.log f"v4: {(v4.x)}, {(v4.y)}") ;; Expected: 5, 15

    ;; Binary *
    (let v5 (* v1 2))
    (console.log f"v5: {(v5.x)}, {(v5.y)}") ;; Expected: 20, 40

    ;; Unary -
    (let v6 (- v1))
    (console.log f"v6: {(v6.x)}, {(v6.y)}") ;; Expected: -10, -20

    ;; Binary ==
    (console.log f"v1 == v1: {(== v1 v1)}") ;; Expected: true
    (console.log f"v1 == v2: {(== v1 v2)}") ;; Expected: false

    ;; Chaining
    (let v7 (+ (+ v1 v2) v2))
    (console.log f"v7: {(v7.x)}, {(v7.y)}") ;; Expected: 20, 30
)

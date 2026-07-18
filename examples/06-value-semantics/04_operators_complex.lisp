(
    (defstruct Complex
        (let :ctor real <- Real 0.0)
        (let :ctor imag <- Real 0.0)

        (fn mag [] -> Real
            (return (Math.sqrt (+ (* this.real this.real) (* this.imag this.imag))))
        )

        (fn arg [] -> Real
            (return (Math.atan2 this.imag this.real))
        )

        (fn str [] -> String
            (return '"{(this.real)} + {(this.imag)}i")
        )
    )

    (fn :operator + [c1 <- Complex c2 <- Complex] -> Complex
        (let result (Complex))
        (result.real := (+ c1.real c2.real))
        (result.imag := (+ c1.imag c2.imag))
        (return result)
    )

    (fn :operator - [c1 <- Complex c2 <- Complex] -> Complex
        (let result (Complex))
        (result.real := (- c1.real c2.real))
        (result.imag := (- c1.imag c2.imag))
        (return result)
    )

    (fn :operator * [c1 <- Complex c2 <- Complex] -> Complex
        (let result (Complex))
        (result.real := (- (* c1.real c2.real) (* c1.imag c2.imag)))
        (result.imag := (+ (* c1.real c2.imag) (* c1.imag c2.real)))
        (return result)
    )

    (fn :operator / [c1 <- Complex c2 <- Complex] -> Complex
        (let denom (+ (* c2.real c2.real) (* c2.imag c2.imag)))
        (let result (Complex))
        (result.real := (/ (+ (* c1.real c2.real) (* c1.imag c2.imag)) denom))
        (result.imag := (/ (- (* c1.imag c2.real) (* c1.real c2.imag)) denom))
        (return result)
    )
    (fn :operator - [c1 <- Complex] -> Complex
        (let result (new Complex))
        (result.real := (- 0 c1.real))
        (result.imag := (- 0 c1.imag))
        (return result)
    )
    (let c1 (new Complex 3 4))
    (let c2 (new Complex 1 2))

    ;; Binary +
    (let c3 (+ c1 c2))
    (console.log (c3.str)) ;; Expected: 4 + 6i

    ;; Binary -
    (let c4 (- c1 c2))
    (console.log (c4.str)) ;; Expected: 2 + 2i

    ;; Binary *
    (let c5 (* c1 c2))
    (console.log (c5.str)) ;; Expected: -5 + 10i

    ;; Unary -
    (let c6 (- c1))
    (console.log (c6.str)) ;; Expected: -3 + -4i

    ;; Binary ==
    (console.log (== c1 c1)) ;; Expected: true
    (console.log (== c1 c2)) ;; Expected: false

    ;; Chaining
    (let c7 (+ (+ c1 c2) c2))
    (console.log (c7.str)) ;; Expected: 6 + 8i
)

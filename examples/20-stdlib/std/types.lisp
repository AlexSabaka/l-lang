(namespace std
    (export Number Complex Vector3)

    (deftype Number Int | Real)

    ;; Complex Number Struct and Operations

    (defstruct Complex
        (let :ctor real <- Real 0.0)
        (let :ctor imag <- Real 0.0)
    )

    ;; (fn :operator + [c1 <- Complex c2 <- Complex] -> Complex
    ;;     (let result (Complex))
    ;;     (result.real := (+ c1.real c2.real))
    ;;     (result.imag := (+ c1.imag c2.imag))
    ;;     (return result)
    ;; )

    ;; (fn :operator - [c1 <- Complex c2 <- Complex] -> Complex
    ;;     (let result (Complex))
    ;;     (result.real := (- c1.real c2.real))
    ;;     (result.imag := (- c1.imag c2.imag))
    ;;     (return result)
    ;; )

    ;; (fn :operator * [c1 <- Complex c2 <- Complex] -> Complex
    ;;     (let result (Complex))
    ;;     (result.real := (- (* c1.real c2.real) (* c1.imag c2.imag)))
    ;;     (result.imag := (+ (* c1.real c2.imag) (* c1.imag c2.real)))
    ;;     (return result)
    ;; )

    ;; (fn :operator / [c1 <- Complex c2 <- Complex] -> Complex
    ;;     (let denom (+ (* c2.real c2.real) (* c2.imag c2.imag)))
    ;;     (let result (Complex))
    ;;     (result.real := (/ (+ (* c1.real c2.real) (* c1.imag c2.imag)) denom))
    ;;     (result.imag := (/ (- (* c1.imag c2.real) (* c1.real c2.imag)) denom))
    ;;     (return result)
    ;; )

    ;; 3D Vector Struct and Operations

    (defstruct Vector3
        (let :ctor x <- Real 0.0)
        (let :ctor y <- Real 0.0)
        (let :ctor z <- Real 0.0)
    )

    ;; (fn :operator + [v1 <- Vector3 v2 <- Vector3] -> Vector3
    ;;     (let result (Vector3))
    ;;     (result.x := (+ v1.x v2.x))
    ;;     (result.y := (+ v1.y v2.y))
    ;;     (result.z := (+ v1.z v2.z))
    ;;     (return result)
    ;; )

    ;; (fn :operator - [v1 <- Vector3 v2 <- Vector3] -> Vector3
    ;;     (let result (Vector3))
    ;;     (result.x := (- v1.x v2.x))
    ;;     (result.y := (- v1.y v2.y))
    ;;     (result.z := (- v1.z v2.z))
    ;;     (return result)
    ;; )

    ;; (fn :operator * [v <- Vector3 scalar <- Real] -> Vector3
    ;;     (let result (Vector3))
    ;;     (result.x := (* v.x scalar))
    ;;     (result.y := (* v.y scalar))
    ;;     (result.z := (* v.z scalar))
    ;;     (return result)
    ;; )

    ;; (fn :operator / [v <- Vector3 scalar <- Real] -> Vector3
    ;;     (let result (Vector3))
    ;;     (result.x := (/ v.x scalar))
    ;;     (result.y := (/ v.y scalar))
    ;;     (result.z := (/ v.z scalar))
    ;;     (return result)
    ;; )

    ;; (fn :operator · [v1 <- Vector3 v2 <- Vector3] -> Real
    ;;     (+ (* v1.x v2.x) (+ (* v1.y v2.y) (* v1.z v2.z)))
    ;; )
)
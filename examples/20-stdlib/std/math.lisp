(
  (import "types.lisp")

  (export sqr sqrt sin cos tan log exp E PI TAU Number Complex Vector3)

  (let E 2.718281828459045)
  (let PI 3.141592653589793)

  (let TAU (* 2 PI))

  (fn sqr [x <- Number] -> Number
    (* x x)
  )

  (fn sqrt [x <- Number] -> Number
    (Math.sqrt x)
  )

  (fn sin [x <- Number] -> Number
    (Math.sin x)
  )

  (fn cos [x <- Number] -> Number
    (Math.cos x)
  )

  (fn tan [x <- Number] -> Number
    (Math.tan x)
  )

  (fn log [x <- Number] -> Number
    (Math.log x)
  )

  (fn exp [x <- Number] -> Number
    (Math.exp x)
  )

  (deftype Number Int | Real)

  ;; Complex Number Struct and Operations

  (defstruct Complex
      (let :ctor real <- Real 0.0)
      (let :ctor imag <- Real 0.0)
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

  ;; 3D Vector Struct and Operations

  (defstruct Vector3
      (let :ctor x <- Real 0.0)
      (let :ctor y <- Real 0.0)
      (let :ctor z <- Real 0.0)
  )

  (fn :operator + [v1 <- Vector3 v2 <- Vector3] -> Vector3
      (let result (Vector3))
      (result.x := (+ v1.x v2.x))
      (result.y := (+ v1.y v2.y))
      (result.z := (+ v1.z v2.z))
      (return result)
  )

  (fn :operator - [v1 <- Vector3 v2 <- Vector3] -> Vector3
      (let result (Vector3))
      (result.x := (- v1.x v2.x))
      (result.y := (- v1.y v2.y))
      (result.z := (- v1.z v2.z))
      (return result)
  )

  (fn :operator * [v <- Vector3 scalar <- Real] -> Vector3
      (let result (Vector3))
      (result.x := (* v.x scalar))
      (result.y := (* v.y scalar))
      (result.z := (* v.z scalar))
      (return result)
  )

  (fn :operator / [v <- Vector3 scalar <- Real] -> Vector3
      (let result (Vector3))
      (result.x := (/ v.x scalar))
      (result.y := (/ v.y scalar))
      (result.z := (/ v.z scalar))
      (return result)
  )

  (fn :operator · [v1 <- Vector3 v2 <- Vector3] -> Real
      (+ (* v1.x v2.x) (+ (* v1.y v2.y) (* v1.z v2.z)))
  )
)
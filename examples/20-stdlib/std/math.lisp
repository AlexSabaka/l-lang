;; Example for the standard library math module
;; Implemented for JavaScript backend
(namespace std.math
  (import "types.lisp")

  (export sqr sqrt sin cos tan log exp E PI TAU)

  (let E 2.718281828459045)
  (let PI 3.141592653589793)

  (let :comptime TAU (* 2 PI))

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

  (export sqr sqrt sin cos tan log exp E PI TAU)
)
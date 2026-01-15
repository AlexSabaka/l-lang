;; Example for the standard library math module
;; Implemented for JavaScript backend
(namespace std.math
  (import { Number } from std.types)

  (fn sqr [x <- Number] -> Number
    (* x x)
  )
)
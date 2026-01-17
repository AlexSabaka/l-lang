(
(import "./types.lisp")

(fn dot-product [v1 v2] (
    (return (+ (* v1.x v2.x) (+ (* v1.y v2.y) (* v1.z v2.z))))
))

(fn magnitude [v] (
    (return (Math.sqrt (dot-product v v)))
))

;; Complex number operations (using objects)
(fn complex-add [c1 c2] (
    (return { real: (+ c1.real c2.real), imag: (+ c1.imag c2.imag) })
))

(fn print-matrix [m] (
    (console.log "Matrix:")
    (for :each row :from m :then (
        (console.log row)
    ))
))

(export dot-product)
(export magnitude)
(export complex-add)
(export print-matrix)
)

(export dot-product magnitude complex-add print-matrix)

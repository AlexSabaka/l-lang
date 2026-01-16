(import "../std/types.lisp")
(import "./types.lisp")
(import "../std/math.lisp")

(fn dot-product [v1 v2]
    (+ (* v1.x v2.x) (+ (* v1.y v2.y) (* v1.z v2.z))))

(fn magnitude [v]
    (sqrt (dot-product v v)))

;; Complex number operations
(fn complex-add [c1 c2]
    ;; Note: Assuming c1 and c2 are structs or similar. 
    ;; In this test, we might construct them manually if literal support is basic.
    (new Complex (+ c1.real c2.real) (+ c1.imag c2.imag)))

(fn print-matrix [m]
    (console.log "Matrix:")
    (for :each row :from m :then
        (console.log row)))

(export dot-product, magnitude, complex-add, print-matrix)

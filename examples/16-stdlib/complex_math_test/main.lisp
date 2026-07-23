(import "./math_utils.lisp")
(import "std/core/types")
(import "std/math")

(fn main []
    (console.log "--- Running Complex Math Test ---")

    ;; 1. Vector Operations
    (let vecA (Vec3 1 0 0))
    (let vecB (Vec3 0 1 0))
    
    (console.log "Vector A:" vecA.x vecA.y vecA.z)
    (console.log "Vector B:" vecB.x vecB.y vecB.z)
    
    (let dp (dot-product vecA vecB))
    (console.log "Dot Product (A . B):" dp) ;; Expected: 0
    
    (let vecC (Vec3 3 4 0))
    (console.log "Vector C:" vecC.x vecC.y vecC.z)
    (console.log "Magnitude of C:" (magnitude vecC)) ;; Expected: 5

    ;; 2. Matrix Literals
    (console.log "--- Matrix Test ---")
    ;; 3x3 Identity Matrix
    (let identity [ 1 0 0 | 0 1 0 | 0 0 1 ])
    (print-matrix identity)

    ;; 3. Complex Numbers
    (console.log "--- Complex Number Test ---")
    (let c1 (Complex 1.0 2.0))
    (let c2 (Complex 3.0 4.0))
    (let c3 (+ c1 c2))
    
    (console.log "Complex Addition Result:" (c3.real) "+" (c3.imag) "i")
)

(main)

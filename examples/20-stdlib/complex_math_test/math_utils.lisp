
(fn dot-product [v1 v2] (
    (return (+ (* v1.x v2.x) (+ (* v1.y v2.y) (* v1.z v2.z))))
))

(fn magnitude [v] (
    (return (Math.sqrt (dot-product v v)))
))


(fn print-matrix [m] (
    (console.log "Matrix:")
    (for :each row :from m :then (
        (console.log row)
    ))
))

(export dot-product magnitude print-matrix)

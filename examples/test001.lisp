(
  (fn create-vector [] (
    (let x (* 2.0 (+ 1.0 2.0)))
    (let y (/ 32.0 (- 10.0 6.0))
    (return [x y])
  )))

  (fn vector-len [vec] (return
    (std.math.sqrt
      (+ (* (head vec) (head vec))
         (* (tail vec) (tail vec))))
  ))

  (let v (call create-vector))
  (let l (vector-len v))

  (std.console.println '"Length of the vector {(v)} is {(l)}")
)

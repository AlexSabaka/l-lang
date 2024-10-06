(
  (fn read-vector [] (
    (std.io.println "Enter number x:")
    (let x (Number (call std.io.readln)))
    (std.io.println "Enter number y:")
    (let y (Number (call std.io.readln)))
    (return [x y])
  ))

  (fn vector-len [vec] (return
    (std.math.sqrt
      (+ (* (head vec) (head vec))
          (* (tail vec) (tail vec))))
  ))

  (let v (call read-vector))
  (let l (vector-len v))

  (std.io.println '"Length of the vector [{(elem v 0)}, {(elem v 1)}] is {(l)}")
)


(
  (fn read-vector [] (
    (std.console.println "Enter number x:")
    (let x (Number (call std.console.readln)))
    (std.console.println "Enter number y:")
    (let y (Number (call std.console.readln)))
    (return [x y])
  ))

  (fn vector-len [vec] (return
    (std.math.sqrt
      (+ (* (head vec) (head vec))
         (* (tail vec) (tail vec))))
  ))

  (let v (call read-vector))
  (let l (vector-len v))

  (std.console.println '"Length of the vector {(v)} is {(l)}")
)


(definterface Shape
  (fn area [] -> Number))

(defclass Circle :implements Shape
  (mut :ctor radius <- Number)
  
  (fn area [] (return (* 3.14159 (* this.radius this.radius)))))

(let circle (Circle 5))
(let shape-type (type circle))
(console.log shape-type["name"])
(console.log (circle.area))

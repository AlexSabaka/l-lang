(definterface Shape
  (fn area [] -> Real))

(defclass Circle :implements Shape
  (mut :ctor radius <- Real)
  
  (fn area [] (return (* 3.14159 (* this.radius this.radius)))))

(let circle (Circle 5))
(let shape-type (type circle))
(console.log shape-type["name"])
(console.log (circle.area))

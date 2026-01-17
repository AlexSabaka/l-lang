(definterface Comparable
  (fn compareTo [other Any] -> Int))

(defclass ComparableValue<T>
  (mut :ctor value <- T)
  
  (fn getValue [] (return this.value)))

(let cv (ComparableValue 42))
(console.log (cv.getValue))

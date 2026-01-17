(defclass Pair<T U>
  (mut :ctor first <- T)
  (mut :ctor second <- U))

(let p (Pair 42 "hello"))
(console.log p.first)
(console.log p.second)

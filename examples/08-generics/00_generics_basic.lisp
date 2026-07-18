(definterface GenericContainer<T>
  (fn get [] -> T)
  (fn set [item <- T] -> Void))

(defclass Container<T> :implements GenericContainer<T>
  (mut :ctor value <- T)
  (fn get [] (return this.value))
  (fn set [item <- T] (this.value := item))
)

(let c (Container 42))
(console.log (c.get))
(console.log (type c))

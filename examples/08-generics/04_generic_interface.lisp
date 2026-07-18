(definterface Container<T>
  (fn get [] -> T)
  (fn set [item <- T] -> Void))

(defclass Box<T> :implements Container<T>
  (mut :ctor item <- T)
  
  (fn get [] (return this.item))
  
  (fn set [item <- T] (this.item := item)))

(let b (Box 100))
(console.log (b.get))
(b.set 200)
(console.log (b.get))

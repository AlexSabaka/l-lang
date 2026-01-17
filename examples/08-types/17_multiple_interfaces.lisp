(definterface Drawable
  (fn draw [] -> Void))

(definterface Serializable
  (fn toJson [] -> Any))

(defclass Shape :implements Drawable Serializable
  (mut :ctor name <- String)
  
  (fn draw []
    (console.log "Drawing shape"))
  
  (fn toJson [] Any
    (return { :name this.name })))

(let shape (Shape "Triangle"))
(shape.draw)

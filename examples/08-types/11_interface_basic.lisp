(definterface Drawable
  (fn draw [] -> Void))

(defclass Circle :implements Drawable
  (mut :ctor radius <- Real)
  (fn draw [] (console.log "Drawing circle...")))

(let c (Circle 5))
(c.draw)

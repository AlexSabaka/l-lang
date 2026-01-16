(import "../std/types.lisp")

(defstruct Vector3
    (let :ctor x)
    (let :ctor y)
    (let :ctor z)
)

(definterface Transformable
   (fn transform [matrix] -> Vector3)
)

(export Vector3 Transformable)

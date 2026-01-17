(
;; Vector3 struct definition
(defstruct Vector3
    (let :ctor x)
    (let :ctor y)  
    (let :ctor z)
)

;; Simple interface for transformable objects
(definterface Transformable
   (fn transform [matrix] -> Vector3)
)

(export Vector3)
(export Transformable)
)

(export Vector3 Transformable)

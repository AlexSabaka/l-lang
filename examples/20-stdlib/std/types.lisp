;; Standard type definitions for the l-lang standard library

;; Basic type aliases
(deftype Number Int | Real)
(deftype Bool Boolean)
(deftype Str String)

;; Common data structures
(deftype List Array)
(deftype Dict Object)

;; Result type for error handling
;; (deftype Result[T, E] (T | E))

;; Option type for nullable values
;; (deftype Option[T] (T | null))

;; Export all types
(export Number Bool Str List Dict is-int is-string is-bool is-array is-nil type-name)

(fn is-int [x] (Number.isInteger x))

(fn is-nil [x] (|| (Object.is x null) (Object.is x undefined)))

(fn get-type [x]
  (let res (if (is-nil x) "Nil" x.constructor.name))
  (return res))

(fn is-string [x] 
  (match (get-type x) {
    "String" => true
    _ => false
  }))

(fn is-bool [x] 
  (match (get-type x) {
    "Boolean" => true
    _ => false
  }))

(fn is-array [x] (Array.isArray x))

(fn type-name [x]
  (let res 
    (if (is-nil x) "Nil"
    (if (is-array x) "Array"
    (if (is-int x) "Int"
    (match (get-type x) {
      "Number" => "Float"
      "String" => "String"
      "Boolean" => "Boolean"
      _ => "Object"
    })))))
  (return res))
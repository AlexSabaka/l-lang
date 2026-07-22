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

;; `typeof`, not `Number.isInteger`. D51 makes an Int a wrapping int64 -- a BigInt on this backend --
;; and `Number.isInteger(1n)` is FALSE, so the old spelling inverted for every Int the moment the
;; numeric floor landed. It was also never quite right: it answered TRUE for `5.0`, a Real that happens
;; to be integral, because f64 could not tell the two apart. `typeof` now can, which is the whole point
;; of D51's representation change.
(fn is-int [x] (== (typeof x) "bigint"))

;; D9: one bottom value. `==` against nil catches BOTH JS representations -- the `null` l-lang emits
;; and the `undefined` a JS library hands back -- so the two-armed Object.is test is no longer needed.
;; It could not survive the migration anyway: Object.is is strict and does not route through the
;; runtime's equality, so a plain spelling swap would have left this blind to half of what it catches.
(fn is-nil [x] (== x nil))

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
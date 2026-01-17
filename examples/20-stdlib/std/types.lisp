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
(export Number Bool Str List Dict)
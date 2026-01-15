;; Type System Basics - Annotations and Inference
;;
;; This example demonstrates:
;; - Explicit type annotations with <-
;; - Type inference for literals
;; - Union types
;; - Type compatibility

(
    ;; 1. Explicit type annotations
    (let x <- Int 42)
    (let name <- String "Sloth")
    (let pi <- Real 3.14159)
    (let flag <- Boolean true)

    ;; 2. Type inference (compiler figures out types)
    (let number 100)           ;; inferred as Int
    (let text "Hello")         ;; inferred as String
    (let ratio 2.5)            ;; inferred as Real
    (let active false)         ;; inferred as Boolean

    ;; 3. Union types (value can be one of several types)
    (let status <- Int | String "loading")
    (status := 200)            ;; Valid - Int is in union
    (status := "done")         ;; Valid - String is in union

    ;; 4. Array types with element specification
    (let numbers <- Int[] [1 2 3 4 5])
    (let strings <- String[] ["a" "b" "c"])

    ;; 5. Type guards with 'is'
    (if (status is String)
        (console.log "Status is a string:" status))

    ;; 6. Type casting with 'as'
    (if (status is String)
        (let s (status as String))
        (console.log "String is:" s))

    (console.log "Type annotations and inference working!")
)

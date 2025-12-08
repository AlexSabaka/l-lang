(
    ;; Mutable variable 'y' without initial value
    (mut y)
    ;; Immutable variable 'x' with initial value 10

    (let x 10)
    ;; Compound assignment to 'y'

    (y := (+ 10 x))

    ;; Log the values of 'x' and 'y'
    (std.console.log "Value x:" x "Value y:" y)

    ;; Vector variable 'v'
    (let v [1 2 3])

    ;; Log the vector 'v'
    (std.console.log v)

    ;; Log the first element of vector 'v'
    (std.console.log "First element from a vector v[0]:" v[0])
    (std.console.log "First element from a vector (head v):" (head v))

    ;; Map variable 'm'
    (let m { :a 1, :b 2 })

    ;; Log the map 'm'
    (std.console.log m)

    ;; Log the value associated with keys "a" and "b" in map 'm'
    (std.console.log "Value a:" m["a"] "Value b:" m["b"])
    (std.console.log (get m "a"))

    ;; Nested lists
    (let nested-list [[1 2] [3 4]])
    (std.console.log nested-list)
    (std.console.log nested-list[1][1])
)
(
    (defstruct vec2
        (let :ctor x <- Real 0)
        (let :ctor y <- Real 0)

        (fn str [] -> String (return '"({(this.x)}, {(this.y)})"))
        (fn length [] -> Real (return (Math.sqrt (+ (* this.x this.x) (* this.y this.y)))))
    
        (fn :static :operator + [a <- vec2 b <- vec2] -> vec2
            (return (vec2 (+ a.x b.x) (+ a.y b.y)))
        )
    )

    ;; Example Usage
    (let v1 (vec2 3.0 4.0))
    (let v2 (vec2 1.0 2.0))

    (console.log '"v1: {(v1.str)}, length: {(v1.length)}")
    (console.log '"v2: {(v2.str)}, length: {(v2.length)}")
)
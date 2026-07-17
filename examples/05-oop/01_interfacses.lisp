(
    (definterface Shape
        (fn area [] -> Real)
        (fn perimeter [] -> Real)
    )

    ;; Rectangle Struct implementing Shape
    (defstruct Rectangle :implements Shape
        (let :public width 0)
        (let :public height 0)

        (fn area [] 
            (return (* this.width this.height)))
            
        (fn perimeter []
            (return (* 2 (+ this.width this.height))))
    )

    ;; Circle Struct implementing Shape
    (defstruct Circle :implements Shape
        (let :public radius 0)
        
        (fn area []
            (return (* 3.14159 (* this.radius this.radius))))

        (fn perimeter []
            (return (* 2 (* 3.14159 this.radius))))
    )

    (fn print-shape-info [s <- Shape] (
        (console.log '"Shape Area: {(s.area)}")
        (console.log '"Shape Perim: {(s.perimeter)}")
    ))

    (let r (Rectangle))
    (r.width := 10)
    (r.height := 20)

    (let c (Circle))
    (c.radius := 5)

    (print-shape-info r)
    (print-shape-info c)

    (console.log (type r))
)
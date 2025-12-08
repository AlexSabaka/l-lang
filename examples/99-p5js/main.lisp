(
    (import "./p5-bindings.lisp")

    (defclass Player 
        (let :public :ctor x y)
        (let :public position (create-vector x y))
        (let :public speed 0)
        (let :public direction 0)
        (let :public rotation-speed 0)

        (fn update [] 
            (let step-x (* this.speed (cos this.direction)))
            (let step-y (* this.speed (sin this.direction)))
            (let new-x (+ this.position.x step-x))
            (let new-y (+ this.position.y step-y))

            (if (! (is-intersecting-walls new-x new-y))
                (
                    (set! this.position.x new-x)
                    (set! this.position.y new-y)
                )
            )

            (set! this.direction (+ this.direction this.rotation-speed))
        )
    )

    ;; Global state
    (let WIDTH 600)
    (let HEIGHT 400)
    (let CELL_SIZE 40)

    (mut player)
    (mut maze-cells [
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 1, 1, 1, 1, 0, 1],
        [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
    ])
    (mut startPos (create-vector 2.5 2.5))

    (fn setup []
        (create-canvas WIDTH HEIGHT)
        (no-stroke)
        
        (player := (Player startPos.x startPos.y)))

    (fn draw [] 
        (background 220)

        ;; Update player
        (player.update call)

        ;; TODO: Draw maze

        ;; Draw player
        (fill 255 0 0)
        (ellipse (* player.position.x CELL_SIZE) (* player.position.y CELL_SIZE) 10 10)
    )
)
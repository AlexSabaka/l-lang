(
    (import "./p5-bindings.lisp")
    (import "./../20-stdlib/std/math.lisp")

    ;; Game constants
    (let WIDTH 600)
    (let HEIGHT 400)
    (let PLAYER-SPEED 5)
    (let PLAYER-SIZE 15)
    (let PLAYER-DIAMETER (* 2 PLAYER-SIZE))

    ;; Player state
    (mut player-pos (new Vector3 100 200 0))
    (mut player-vel (new Vector3 0 0 0))

    ;; Handle input
    (fn handle-input [] (
        ;; Move left
        (if (key-is-down LEFT-ARROW)
            (player-vel.x := (- PLAYER-SPEED))
        )
        ;; Move right
        (if (key-is-down RIGHT-ARROW)
            (player-vel.x := PLAYER-SPEED)
        )
        ;; Move up
        (if (key-is-down UP-ARROW)
            (player-vel.y := (- PLAYER-SPEED))
        )
        ;; Move down
        (if (key-is-down DOWN-ARROW)
            (player-vel.y := PLAYER-SPEED)
        )
    ))

    ;; Update physics
    (fn update-physics [] (
        ;; Update position
        (player-pos := (+ player-pos player-vel))
        (player-vel := (* player-vel 0.95))

        ;; Boundary checks
        (if (< player-pos.x 0) (player-pos.x := 0))
        (if (> (+ player-pos.x PLAYER-SIZE) WIDTH)
            (player-pos.x := (- WIDTH PLAYER-SIZE))
        )

        (if (< player-pos.y 0) (player-pos.y := 0))
        (if (> (+ player-pos.y PLAYER-SIZE) HEIGHT)
            (player-pos.y := (- HEIGHT PLAYER-SIZE))
        )
    ))

    ;; Draw everything
    (fn draw-game [] (
        ;; Draw player
        (fill 255 100 100)  ;; Red
        (ellipse player-pos.x player-pos.y PLAYER-DIAMETER PLAYER-DIAMETER)
        
        ;; Draw debug info
        (fill 0 0 0)  ;; Black
        (text-size 14)
        (text (player-pos.str) 10 40)
        (text (player-vel.str) 10 60)
    ))

    ;; P5.js setup - runs once
    (fn setup [] (
        (create-canvas WIDTH HEIGHT)
        (background 135 206 235)
    ))

    ;; P5.js draw - runs every frame
    (fn draw [] (
        (background 135 206 235)  ;; Sky blue
        (fill 123 200 278)
        (handle-input)
        (update-physics)
        (draw-game)
    ))

    (if (!= window nil) (
        (window.setup := setup)
        (window.draw := draw)
    ))
)

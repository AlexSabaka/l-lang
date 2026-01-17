(
    (import "./p5-bindings.lisp")
    (import "./../20-stdlib/std/math.lisp")

    ;; Game constants
    (let WIDTH 600)
    (let HEIGHT 400)
    (let GRAVITY 0.6)
    (let PLAYER-SPEED 5)
    (let PLAYER-JUMP 12)
    (let PLAYER-SIZE 30)

    ;; Player state
    (mut player-pos (new Vector3 100 200))
    (mut player-vel (new Vector3 0 0))
    (mut player-grounded false)


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
        ;; Jump
        (if (&& (key-is-down SPACE) player-grounded)
            (player-vel.y := (- PLAYER-JUMP))
        )
    ))

    ;; Update physics
    (fn update-physics [] (
        ;; Apply gravity
        (player-vel.y := (+ player-vel.y GRAVITY))
        
        ;; Update position
        (player-pos.x := (+ player-pos.x player-vel.x))
        (player-pos.y := (+ player-pos.y player-vel.y))
        
        ;; Reset horizontal velocity
        (player-vel.x := 0)
        
        ;; Check ground collision
        (player-grounded := (on-platform))
        
        ;; Boundary checks
        (if (< player-pos.x 0) (player-pos.x := 0))
        (if (> (+ player-pos.x PLAYER-SIZE) WIDTH)
            (player-pos.x := (- WIDTH PLAYER-SIZE))
        )
        
        ;; Death plane
        (if (> player-pos.y HEIGHT)
            (player-pos.y := 200)
        )

        (console.log "Player X:" player-pos.x "Y:" player-pos.y)
    ))

    ;; Draw everything
    (fn draw-game [] (
        ;; Draw platforms
        (fill 100 100 100)  ;; Dark gray
        (for :each p :from platforms :then (
            (rect p.x p.y p.w p.h)
        ))
        
        ;; Draw player
        (fill 255 100 100)  ;; Red
        (rect player-x player-y PLAYER-SIZE PLAYER-SIZE)
        
        ;; Draw debug info
        (fill 0 0 0)  ;; Black
        (text-size 14)
        (text (+ "X: " player-x) 10 20)
        (text (+ "Y: " player-y) 10 40)
        (text (+ "Grounded: " player-grounded) 10 60)
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
        (ellipse 700 100 80 80)  ;; Sun
        (handle-input)
        (update-physics)
        (draw-game)
    ))

    (if (!= window nil) (
        window.setup := setup
        window.draw := draw
    ))
)

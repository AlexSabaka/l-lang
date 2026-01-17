(
    (import "./p5-bindings.lisp")

    ;; Game constants
    (let WIDTH 600)
    (let HEIGHT 400)
    (let GRAVITY 0.6)
    (let PLAYER-SPEED 5)
    (let PLAYER-JUMP 12)
    (let PLAYER-SIZE 30)

    ;; Player state
    (mut player-x 100)
    (mut player-y 200)
    (mut player-vx 0)
    (mut player-vy 0)
    (mut player-grounded false)

    ;; Platforms (simple rectangles)
    (let platforms [
        { :x 0 :y 550 :w 800 :h 50 }
        { :x 200 :y 450 :w 200 :h 20 }
        { :x 500 :y 350 :w 200 :h 20 }
    ])


    ;; Helper: Check if player is on ground
    (fn on-platform [] (
        (mut on false)
        (for :each p :from platforms :then (
            (let py (+ p.y p.h))
            (let px-min p.x)
            (let px-max (+ p.x p.w))
            (let player-bottom (+ player-y PLAYER-SIZE))
            
            ;; Check AABB collision
            (if (&& 
                    (>= player-bottom (- py 2))
                    (<= player-bottom (+ py 2))
                    (>= player-x px-min)
                    (<= (+ player-x PLAYER-SIZE) px-max))
                (on := true)
            )
        ))
        (return on)
    ))

    ;; Handle input
    (fn handle-input [] (
        ;; Move left
        (if (key-is-down LEFT-ARROW)
            (player-vx := (- PLAYER-SPEED))
        )
        ;; Move right
        (if (key-is-down RIGHT-ARROW)
            (player-vx := PLAYER-SPEED)
        )
        ;; Jump
        (if (&& (key-is-down SPACE) player-grounded)
            (player-vy := (- PLAYER-JUMP))
        )
    ))

    ;; Update physics
    (fn update-physics [] (
        ;; Apply gravity
        (player-vy := (+ player-vy GRAVITY))
        
        ;; Update position
        (player-x := (+ player-x player-vx))
        (player-y := (+ player-y player-vy))
        
        ;; Reset horizontal velocity
        (player-vx := 0)
        
        ;; Check ground collision
        (player-grounded := (on-platform))
        
        ;; Boundary checks
        (if (< player-x 0) (player-x := 0))
        (if (> (+ player-x PLAYER-SIZE) WIDTH)
            (player-x := (- WIDTH PLAYER-SIZE))
        )
        
        ;; Death plane
        (if (> player-y HEIGHT)
            (player-y := 200)
        )

        (console.log "Player X:" player-x "Y:" player-y)
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

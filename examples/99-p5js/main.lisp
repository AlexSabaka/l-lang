(
    (import "./p5-bindings.lisp")
    (import "../20-stdlib/std/math.lisp")
    (import "../20-stdlib/std/enumerable.lisp")

    (p5.disableFriendlyErrors := true)

    ;; ==================== GAME CONSTANTS ====================
    (let WIDTH 400)
    (let HEIGHT 600)
    (let GRAVITY 0.8)
    (let JUMP-FORCE -30)
    (let PLAYER-SIZE 40)
    (let PLATFORM-WIDTH 80)
    (let PLATFORM-HEIGHT 15)
    (let SCROLL-THRESHOLD 300)
    (let PLATFORM-SPAWN-Y -10)

    ;; ==================== UTILITY FUNCTIONS ====================
    (fn rand [min <- Real max <- Real] -> Real (
        (+ min (* (call Math.random) (- max min)))
    ))

    (fn random-int [min <- Int max <- Int] -> Int (
        (floor (rand min (+ max 1)))
    ))

    (fn clamp [val <- Real min <- Real max <- Real] -> Real (
        (return (if (< val min) min 
                (if (> val max) max 
                                val)))
    ))

    (fn overlaps [x1 y1 w1 h1 x2 y2 w2 h2] -> Boolean (
        (&& (< x1 (+ x2 w2))
            (> (+ x1 w1) x2)
            (< y1 (+ y2 h2))
            (> (+ y1 h1) y2))
    ))

    ;; ==================== PLATFORM CLASS ====================
    (defclass Platform
        (let :ctor x <- Real 0)
        (let :ctor y <- Real 0)
        (let width <- Real PLATFORM-WIDTH)
        (let height <- Real PLATFORM-HEIGHT)

        (fn update [] (
        ))

        (fn draw [] (
            (fill 150 150 150)
            (rect this.x this.y this.width this.height 5)
        ))

        (fn check-collision [px py pw ph pvy] -> Real 
            (&& (> pvy 0) (overlaps px py pw ph this.x this.y this.width this.height))
        )
    )

    ;; ==================== PLAYER CLASS ====================
    (defclass Player
        (let :ctor pos <- Vector3)
        (let width <- Real PLAYER-SIZE)
        (let height <- Real PLAYER-SIZE)
        (let vel <- Vector3 (new Vector3 0 0 0))
        (let is-jumping <- Bool false)

        (fn update [] (
            ;; Apply gravity
            (this.vel.y += GRAVITY)

            ;; Update position
            (this.pos := (+ this.pos this.vel))

            ;; Friction
            (this.vel := (* this.vel 0.9))

            ;; Wrap around screen horizontally
            (if (< this.pos.x (- this.width)) (this.pos.x := WIDTH))
            (if (> this.pos.x WIDTH) (this.pos.x := (- this.width)))

            ;; Clamp velocity
            (this.vel.y := (clamp this.vel.y -20 20))
        ))

        (fn draw [] (
            ;; Draw player body
            (fill 255 150 150)
            (ellipse (+ this.pos.x (/ this.width 2)) 
                    (+ this.pos.y (/ this.height 2)) 
                    this.width 
                    this.height)

            ;; Draw face
            (fill 50 50 50)
            (ellipse (+ this.pos.x 12) (+ this.pos.y 15) 5 5)  ;; Left eye
            (ellipse (+ this.pos.x 28) (+ this.pos.y 15) 5 5)  ;; Right eye

            (arc (+ this.pos.x 20) (+ this.pos.y 30) 15 10 0 3.14)  ;; Smile
        ))

        (fn is-falling [] -> Bool (
            (> this.vel.y 0)
        ))
    )

    ;; ==================== GAME STATE ====================
    (mut game-state {
        :player nil
        :platforms []
        :camera-y 0
        :score 0
        :high-score 0
        :game-over false
    })

    ;; ==================== FUNCTIONAL GAME LOGIC ====================

    ;; Create initial platforms using functional approach
    (fn generate-initial-platforms [] (
        (let platforms [])
        (for :init (mut i 0) :cond (< i 10) :step (i += 1) :then (
            (let platform (new Platform 
                (rand 0 (- WIDTH PLATFORM-WIDTH))
                (- HEIGHT (* i 60))
            ))
            (platforms.push platform)
        ))
        (return platforms)
    ))

    ;; Spawn new platform at top
    (fn spawn-platform [camera-y] -> Platform (
        (let platform (new Platform 
            (rand 0 (- WIDTH PLATFORM-WIDTH))
            (- camera-y 50)
            (random-platform-type)))
        (platform.init)
        (return platform)
    ))

    ;; Update camera position using functional pipeline
    (fn update-viewport [] (
        (let player game-state.player)
        (if (< player.pos.y SCROLL-THRESHOLD) ( 
            (let scroll-amount (- SCROLL-THRESHOLD player.pos.y))
            (game-state.camera-y -= scroll-amount)
            (player.pos.y := SCROLL-THRESHOLD)

            ;; Move platforms down
            (for :each platform :from game-state.platforms :then (
                (platform.y += scroll-amount)

                (if (> platform.y HEIGHT) (
                    ;; Teleport platform to top
                    (platform.y := PLATFORM-SPAWN-Y)
                    (platform.x := (rand 0 (- WIDTH PLATFORM-WIDTH)))
                ))
            ))

            ;; Update score (functional approach)
            (game-state.score := (floor (/ (abs game-state.camera-y) 10)))
        ))
    ))

    ;; ==================== INPUT HANDLING ====================
    (fn handle-input [] (
        (let player game-state.player)
        (if (key-is-down 37) (player.vel.x := -5))
        (if (key-is-down 39) (player.vel.x := 5))
        
        ;; Restart on space if game over
        (if (&& game-state.game-over (key-is-down 32))
            (init-game))
    ))

    ;; ==================== COLLISION DETECTION ====================
    (fn check-collisions [] (
        (let player game-state.player)
        (if (player.is-falling) (
            (for :each platform :from game-state.platforms :then (
                (if (platform.check-collision player.pos.x player.pos.y player.width player.height player.vel.y)
                    (player.vel.y := JUMP-FORCE)
                )
            ))
        ))
    ))

    ;; ==================== GAME INITIALIZATION ====================
    (fn init-game [] (
        (game-state.player := (new Player (new Vector3 (/ WIDTH 2) (/ HEIGHT 2) 0)))
        (game-state.platforms := (generate-initial-platforms))
        (game-state.boosters := [])
        (game-state.camera-y := 0)
        (game-state.score := 0)
        (game-state.game-over := false)
    ))

    ;; ==================== P5.JS LIFECYCLE ====================
    (fn setup [] (
        (create-canvas WIDTH HEIGHT)
        (frameRate 20)
        (init-game)
    ))

    (fn draw [] (
        ;; Clear screen
        (background 135 206 250)
        
        (if game-state.game-over (return))

        ;; Handle input
        (update-viewport)
        (handle-input)
        
        ;; Update all entities
        (check-collisions)
        (game-state.player.update)
        (for :each p :from game-state.platforms :then (p.update))
        (for :each b :from game-state.boosters :then (b.update))
        
        ;; Render with camera offset

        ;; Draw all platforms
        (for :each p :from game-state.platforms :then (p.draw))

        ;; Draw player
        (game-state.player.draw)

        ;; Draw score
        (fill 0 0 0)
        (text-size 20)
        (text-align LEFT TOP)
        (text (+ "Score: " game-state.score) 10 40)
    ))

    ;; Attach to window
    (if (!= window nil) (
        (window.setup := setup)
        (window.draw := draw)
    ))
)
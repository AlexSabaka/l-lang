(
    (import "./p5-bindings.lisp")
    (import "../20-stdlib/std/math.lisp")
    (import "../20-stdlib/std/enumerable.lisp")

    ;; ==================== GAME CONSTANTS ====================
    (let WIDTH 400)
    (let HEIGHT 600)
    (let GRAVITY 0.6)
    (let JUMP-FORCE -15)
    (let PLAYER-SIZE 40)
    (let PLATFORM-WIDTH 80)
    (let PLATFORM-HEIGHT 15)
    (let SCROLL-THRESHOLD 250)
    (let PLATFORM-SPAWN-Y 100)

    ;; ==================== UTILITY FUNCTIONS ====================
    (fn rand [min <- Real max <- Real] -> Real (
        (+ min (* (call Math.random) (- max min)))
    ))

    (fn random-int [min <- Int max <- Int] -> Int (
        (floor (rand min (+ max 1)))
    ))

    (fn clamp [val <- Real min <- Real max <- Real] -> Real (
        (if (< val min) min
            (if (> val max) max val))
    ))

    (fn overlaps [x1 y1 w1 h1 x2 y2 w2 h2] -> Boolean (
        (&& (< x1 (+ x2 w2))
            (> (+ x1 w1) x2)
            (< y1 (+ y2 h2))
            (> (+ y1 h1) y2))
    ))

    ;; ==================== PLATFORM TYPES ====================
    (defenum PlatformType
        :Normal
        :Moving
        :Breaking
        :Spring
    )

    ;; ==================== PLATFORM CLASS ====================
    (defclass Platform
        (let :ctor x <- Real 0)
        (let :ctor y <- Real 0)
        (let :ctor type <- Int PlatformType:Normal)
        (let width <- Real PLATFORM-WIDTH)
        (let height <- Real PLATFORM-HEIGHT)
        (let vel-x <- Real 0)
        (let broken <- Bool false)
        (let move-range <- Real 100)
        (let origin-x <- Real 0)

        (fn init [] (
            (this.origin-x := this.x)
            (match this.type {
                1 => (this.vel-x := (rand -2 2))
                _ => (this.vel-x := 0)
            })
        ))

        (fn update [] (
            (match this.type {
                PlatformType:Moving => (  ;; Moving platform logic
                    (this.x += this.vel-x)
                    (if (|| (< this.x (- this.origin-x this.move-range))
                            (> this.x (+ this.origin-x this.move-range)))
                        (this.vel-x := (- this.vel-x)))
                )
                _ => nil
            })
        ))

        (fn draw [] (
            (if (! this.broken) (
                (call push)
                (match this.type {
                    PlatformType:Normal => (fill 100 200 100)
                    PlatformType:Moving => (fill 100 150 255)
                    PlatformType:Breaking => (fill 200 100 100)
                    PlatformType:Spring => (fill 255 200 50)
                    _ => (fill 150 150 150)
                })
                (rect this.x this.y this.width this.height 5)
                
                ;; Draw spring visual
                (if (== this.type PlatformType:Spring) (
                    (fill 255 150 0)
                    (rect (+ this.x 30) (- this.y 8) 20 8 2)
                ))
                
                (call pop)
            ))
        ))

        (fn check-collision [px py pw ph pvy] -> Real (
            (if (&& (! this.broken)
                    (> pvy 0)
                    (overlaps px py pw ph this.x this.y this.width this.height))
                (
                    ;; Handle collision based on type
                    (match this.type {
                        PlatformType:Breaking => (this.broken := true)
                        PlatformType:Spring => (return (* JUMP-FORCE 1.5))
                        _ => nil
                    })
                    (return JUMP-FORCE)
                )
                (return 0)
            )
        ))
    )

    ;; ==================== BOOSTER CLASS ====================
    (defenum BoosterType
        :Jetpack
        :SpringShoes
        :Shield
    )

    (defclass Booster
        (let :ctor x <- Real 0)
        (let :ctor y <- Real 0)
        (let :ctor type <- Int BoosterType:Jetpack)
        (let width <- Real 30)
        (let height <- Real 30)
        (let collected <- Bool false)
        (let rotation <- Real 0)

        (fn update [] (
            (this.rotation += 0.05)
        ))

        (fn draw [] (
            (if (! this.collected) (
                (call push)
                (translate (+ this.x 15) (+ this.y 15))
                (rotate this.rotation)
                
                (match this.type {
                    0 => (
                        (fill 255 100 100)
                        (rect -15 -15 30 30 5)
                        (fill 255 200 100)
                        (triangle -10 15 0 25 10 15)
                    )
                    1 => (
                        (fill 100 255 100)
                        (ellipse 0 0 30 30)
                        (fill 50 200 50)
                        (rect -10 -5 20 10)
                    )
                    2 => (
                        (fill 100 200 255)
                        (ellipse 0 0 35 35)
                        (fill 150 220 255)
                        (ellipse 0 0 25 25)
                    )
                    _ => nil
                })
                
                (call pop)
            ))
        ))

        (fn check-collision [px py pw ph] -> Bool (
            (if (&& (! this.collected)
                    (overlaps px py pw ph this.x this.y this.width this.height))
                (
                    (this.collected := true)
                    (return true)
                )
                (return false)
            )
        ))
    )

    ;; ==================== PLAYER CLASS ====================
    (defclass Player
        (let :ctor pos <- Vector3)
        (let width <- Real PLAYER-SIZE)
        (let height <- Real PLAYER-SIZE)
        (let vel <- Vector3 (new Vector3 0 0 0))
        (let is-jumping <- Bool false)
        (let jetpack-active <- Bool false)
        (let jetpack-fuel <- Real 0)
        (let spring-shoes <- Bool false)
        (let shield <- Bool false)

        (fn update [] (
            ;; Apply gravity
            (if this.jetpack-active
                (
                    (this.vel.y := -8)
                    (this.jetpack-fuel -= 1)
                    (if (<= this.jetpack-fuel 0)
                        (this.jetpack-active := false))
                )
                ;; (this.vel.y += GRAVITY)
            )

            ;; Update position
            (this.pos := (+ this.pos this.vel))

            ;; Friction
            (this.vel := (* this.vel 0.9))

            ;; Wrap around screen horizontally
            (if (< this.pos.x (- this.width)) (this.pos.x := WIDTH))
            (if (> this.pos.x WIDTH) (this.pos.x := (- this.width)))

            ;; Clamp velocity
            ;; (this.vel.y := (clamp this.vel.y -20 20))

        ))

        (fn draw [] (
            (call push)

            ;; Draw shield effect
            (if this.shield (
                (no-fill)
                (stroke 100 200 255)
                (stroke-weight 3)
                (ellipse (+ this.pos.x (/ this.width 2)) 
                        (+ this.pos.y (/ this.height 2)) 
                        (+ this.width 20) 
                        (+ this.height 20))
            ))

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

            ;; Draw jetpack flames
            (if this.jetpack-active (
                (fill 255 200 100)
                (triangle (+ this.pos.x 10) (+ this.pos.y 40)
                          (+ this.pos.x 20) (+ this.pos.y (+ 50 (rand 0 10)))
                          (+ this.pos.x 30) (+ this.pos.y 40))
            ))

            ;; Draw spring shoes indicator
            (if this.spring-shoes (
                (fill 100 255 100)
                (rect (+ this.pos.x 5) (+ this.pos.y 35) 10 8)
                (rect (+ this.pos.x 25) (+ this.pos.y 35) 10 8)
            ))

            (call pop)
        ))

        (fn move-left [] (
            (this.vel.x := -5)
        ))

        (fn move-right [] (
            (this.vel.x := 5)
        ))

        (fn jump [] (
            (if this.spring-shoes
                (this.vel.y := (* JUMP-FORCE 1.3))
                (this.vel.y := JUMP-FORCE))
        ))

        (fn activate-booster [type] (
            (match type {
                BoosterType:Jetpack => (
                    (this.jetpack-active := true)
                    (this.jetpack-fuel := 120)
                )
                BoosterType:SpringShoes => (this.spring-shoes := true)
                BoosterType:Shield => (this.shield := true)
                _ => nil
            })
        ))

        (fn is-falling [] -> Bool (
            (> this.vel.y 0)
        ))
    )

    ;; ==================== GAME STATE ====================
    (mut game-state {
        :player nil
        :platforms []
        :boosters []
        :camera-y 0
        :score 0
        :high-score 0
        :game-over false
    })

    ;; ==================== FUNCTIONAL GAME LOGIC ====================
    
    ;; Generate random platform type with weights
    (fn random-platform-type [] -> Int (
        (let roll (rand 0 100))
        (return (cond
            ((< roll 60) PlatformType:Normal)
            ((< roll 80) PlatformType:Moving)
            ((< roll 95) PlatformType:Breaking)
            (true PlatformType:Spring)))
    ))

    ;; Create initial platforms using functional approach
    (fn generate-initial-platforms [] (
        (let platforms [])
        (for :init (mut i 0) :cond (< i 10) :step (i += 1) :then (
            (let platform (new Platform 
                (rand 0 (- WIDTH PLATFORM-WIDTH))
                (- HEIGHT (* i 60))
                (if (== i 0) PlatformType:Normal (random-platform-type))))
            (platform.init)
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

    ;; Maybe spawn booster (10% chance)
    (fn maybe-spawn-booster [camera-y] (
        (if (< (rand 0 100) 10) (
            (let booster (new Booster
                (rand 50 (- WIDTH 50))
                (- camera-y (rand 100 200))
                (random-int 0 2)))
            (game-state.boosters.push booster)
        ))
    ))

    ;; Update camera position using functional pipeline
    (fn update-camera [] (
        (let player game-state.player)
        (if (< player.y SCROLL-THRESHOLD) (
            (let scroll-amount (- SCROLL-THRESHOLD player.y))
            (game-state.camera-y -= scroll-amount)
            (player.y := SCROLL-THRESHOLD)
            
            ;; Update score (functional approach)
            (game-state.score := (floor (/ (abs game-state.camera-y) 10)))
        ))
    ))

    ;; Remove off-screen platforms and spawn new ones
    (fn manage-platforms [] (
        ;; Filter out platforms below screen (functional)
        (game-state.platforms := 
            (filter 
                (fn [p] (< (- p.y game-state.camera-y) (+ HEIGHT 100)))
                game-state.platforms))
        
        ;; Spawn new platforms at top if needed
        (mut highest-platform 
            (reduce 
                (fn [min-y p] (if (< p.y min-y) p.y min-y))
                0
                game-state.platforms))
        
        (while (> highest-platform (- game-state.camera-y 100)) (
            (game-state.platforms.push (spawn-platform game-state.camera-y))
            (maybe-spawn-booster game-state.camera-y)
            (highest-platform -= 60)
        ))
    ))

    ;; Check collisions using functional approach
    (fn check-collisions [] (
        (let player game-state.player)
        
        (if (player.is-falling) (
            ;; Check platform collisions
            (for :each platform :from game-state.platforms :then (
                (let jump-force (platform.check-collision 
                    player.x player.y player.width player.height player.vel-y))
                (if (!= jump-force 0) (
                    (player.jump)
                    (player.vel-y := jump-force)
                ))
            ))
            
            ;; Check booster collisions
            (for :each booster :from game-state.boosters :then (
                (if (booster.check-collision player.x player.y player.width player.height) (
                    (player.activate-booster booster.type)
                ))
            ))
        ))
    ))

    ;; Check game over condition
    (fn check-game-over [] (
        (let player game-state.player)
        (if (> (- player.y game-state.camera-y) HEIGHT) (
            (game-state.game-over := true)
            (if (> game-state.score game-state.high-score)
                (game-state.high-score := game-state.score))
        ))
    ))

    ;; ==================== INPUT HANDLING ====================
    (fn handle-input [] (
        (let player game-state.player)
        (if (== keyCode 37) (player.move-left))
        (if (== keyCode 39) (player.move-right))
        
        ;; Restart on space if game over
        (if (&& game-state.game-over (== keyCode 32))
            (init-game))
    ))

    ;; ==================== RENDERING ====================
    (fn draw-hud [] (
        (call push)
        (fill 50 50 50)
        (text-size 20)
        (text '"Score: {(game-state.score)}" 10 30)
        (text '"High: {(game-state.high-score)}" 10 55)
        
        (if game-state.game-over (
            (fill 255 50 50)
            (text-size 40)
            (text-align CENTER CENTER)
            (text "GAME OVER" (/ WIDTH 2) (/ HEIGHT 2))
            (text-size 20)
            (text "Press SPACE to restart" (/ WIDTH 2) (+ (/ HEIGHT 2) 50))
        ))
        (call pop)
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
        (rect-mode CENTER)
        (init-game)
    ))

    (fn draw [] (
        ;; Clear screen
        (background 135 206 250)  ;; Sky blue
        
        (if game-state.game-over
            (draw-hud)
            (
                ;; Handle input
                (handle-input)
                
                ;; Update all entities
                (game-state.player.update)
                (for :each p :from game-state.platforms :then (p.update))
                (for :each b :from game-state.boosters :then (b.update))
                
                ;; Game logic
                (check-collisions)
                (update-camera)
                (manage-platforms)
                (check-game-over)
                
                ;; Render with camera offset
                (call push)
                (translate 0 game-state.camera-y)
                
                ;; Draw all platforms
                (for :each p :from game-state.platforms :then (p.draw))
                
                ;; Draw all boosters
                (for :each b :from game-state.boosters :then (b.draw))
                
                ;; Draw player
                (game-state.player.draw)
                
                (call pop)
                
                ;; Draw HUD (no camera offset)
                (draw-hud)
            )
        )
    ))

    ;; Attach to window
    (if (!= window nil) (
        (window.setup := setup)
        (window.draw := draw)
    ))
)
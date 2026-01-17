(
    ;; Canvas & Rendering
    (fn create-canvas [w h]
        (createCanvas w h))

    ;; (fn background [c]
    ;;     (background c))

    ;; (fn fill [r g b]
    ;;     (fill r g b))

    (fn no-fill []
        (noFill))

    ;; (fn stroke [r g b]
    ;;     (stroke r g b))

    (fn no-stroke []
        (noStroke))

    (fn stroke-weight [w]
        (strokeWeight w))

    ;; Drawing shapes
    ;; (fn rect [x y w h]
    ;;     (rect x y w h))

    ;; (fn ellipse [x y w h]
    ;;     (ellipse x y w h))

    ;; (fn line [x1 y1 x2 y2]
    ;;     (line x1 y1 x2 y2))

    ;; Input
    (fn key-is-down [code]
        (keyIsDown code))

    ;; Key codes
    (let LEFT-ARROW 37)
    (let RIGHT-ARROW 39)
    (let UP-ARROW 38)
    (let DOWN-ARROW 40)
    (let SPACE 32)

    ;; Text
    ;; (fn text [msg x y]
    ;;     (text msg x y))

    (fn text-size [sz]
        (textSize sz))

    ;; Transform
    ;; (fn push []
    ;;     (push))

    ;; (fn pop []
    ;;     (pop))

    ;; (fn translate [x y]
    ;;     (translate x y))

    ;; Math
    ;; (fn constrain [val lo hi]
    ;;     (constrain val lo hi))

    ;; (fn dist [x1 y1 x2 y2]
    ;;     (dist x1 y1 x2 y2))

    ;; Frame rate
    (fn frame-rate [fps]
        (frameRate fps))

    (fn get-frame-rate []
        (frameRate))

    ;; Export all
    (export 
        create-canvas no-fill no-stroke stroke-weight
        key-is-down LEFT-ARROW RIGHT-ARROW UP-ARROW DOWN-ARROW SPACE
        text-size frame-rate get-frame-rate)
)
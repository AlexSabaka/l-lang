(
    ;; ==================== CANVAS & RENDERING ====================
    (fn create-canvas [w h]
        (createCanvas w h))

    (fn no-fill []
        (call noFill))

    (fn no-stroke []
        (call noStroke))

    (fn stroke-weight [w]
        (strokeWeight w))

    ;; ==================== INPUT ====================
    (fn key-is-down [code]
        (keyIsDown code))

    (fn mouse-is-pressed []
        (mouseIsPressed))

    (fn get-mouse-x []
        mouseX)

    (fn get-mouse-y []
        mouseY)

    ;; Key codes
    (let LEFT-ARROW 37)
    (let RIGHT-ARROW 39)
    (let UP-ARROW 38)
    (let DOWN-ARROW 40)
    (let SPACE 32)
    (let ENTER 13)
    (let SHIFT 16)
    (let CONTROL 17)
    (let ALT 18)

    ;; ==================== TEXT ====================
    (fn text-size [sz]
        (textSize sz))

    (fn text-align [h v]
        (textAlign h v))

    (fn text-font [font]
        (textFont font))

    (fn load-font [path]
        (loadFont path))

    ;; Text alignment constants
    (let LEFT 37)    ;; Using arrow key value as fallback
    (let RIGHT 39)
    (let CENTER 0)
    (let TOP 1)
    (let BOTTOM 2)

    ;; ==================== DRAWING MODES ====================
    (fn rect-mode [mode]
        (rectMode mode))

    (fn ellipse-mode [mode]
        (ellipseMode mode))

    (fn image-mode [mode]
        (imageMode mode))

    ;; Mode constants
    (let CORNER 0)
    (let CORNERS 1)
    ;; (let CENTER 2)
    (let RADIUS 3)

    ;; ==================== MATH ====================
    (fn map-range [value start1 stop1 start2 stop2]
        (map value start1 stop1 start2 stop2))

    ;; ==================== RANDOM ====================
    (fn random-gaussian [mean sd]
        (if (is-nil sd)
            (randomGaussian)
            (randomGaussian mean sd)))

    ;; ==================== IMAGES ====================
    (fn load-image [path]
        (loadImage path))

    (fn no-tint []
        (call noTint))

    ;; ==================== FRAME RATE ====================
    (fn frame-rate [fps]
        (frameRate fps))

    (fn get-frame-rate []
        (frameRate))

    (fn get-frame-count []
        frameCount)

    ;; ==================== COLOR ====================
    (fn color-mode [mode max1 max2 max3 max4]
        (if (is-nil max4)
            (if (is-nil max3)
                (if (is-nil max2)
                    (if (is-nil max1)
                        (colorMode mode)
                        (colorMode mode max1))
                    (colorMode mode max1 max2))
                (colorMode mode max1 max2 max3))
            (colorMode mode max1 max2 max3 max4)))

    (fn create-color [r g b a]
        (if (is-nil a)
            (if (is-nil b)
                (color r)
                (color r g b))
            (color r g b a)))

    ;; Color mode constants
    (let RGB 0)
    (let HSB 1)

    ;; ==================== SHAPE ====================
    (fn begin-shape []
        (beginShape))

    (fn end-shape [close-mode]
        (if (is-nil close-mode)
            (endShape)
            (endShape close-mode)))

    (fn curve-vertex [x y]
        (curveVertex x y))

    (fn bezier-vertex [x2 y2 x3 y3 x4 y4]
        (bezierVertex x2 y2 x3 y3 x4 y4))

    ;; ==================== EXPORT ALL ====================
    ;; Canvas
    (export create-canvas no-fill no-stroke stroke-weight)
    
    ;; Input
    (export key-is-down mouse-is-pressed get-mouse-x get-mouse-y
    LEFT-ARROW RIGHT-ARROW UP-ARROW DOWN-ARROW SPACE ENTER SHIFT CONTROL ALT)
    
    ;; Text
    (export text-size text-align text-font load-font LEFT RIGHT CENTER TOP BOTTOM)
        
    ;; Drawing modes
    (export rect-mode ellipse-mode image-mode)
    (export CORNER CORNERS RADIUS)
    
    ;; Math
    (export map-range)
    
    ;; Random
    (export random-gaussian)
    
    ;; Images
    (export load-image no-tint)
    
    ;; Frame
    (export frame-rate get-frame-rate get-frame-count)
    
    ;; Color
    (export color-mode create-color RGB HSB)
    
    ;; Shape
    (export begin-shape end-shape curve-vertex bezier-vertex)
)
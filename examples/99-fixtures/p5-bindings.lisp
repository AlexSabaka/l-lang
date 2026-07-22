(
    ;; `is-nil` was called 8 times in this file and imported by nobody -- the file had no (import ...)
    ;; line at all. Eight of its LL0210s were never about p5; they were a missing import.
    (import "std/core/types")

    ;; ================================================================================================
    ;; THE p5.js AMBIENT SURFACE
    ;;
    ;; DECLARED (`:extern`), never defined. The host -- p5.js, loaded in a <script> tag -- provides
    ;; every one of these. l-lang emits no binding for them, so the call site compiles to a bare
    ;; reference, which is exactly what it must be.
    ;;
    ;; Until Sd the language could not say this at all, so these 27 names were simply UNDEFINED and
    ;; the file carried 44 diagnostics as a permanent condition. `:extern` parsed in both frontends
    ;; the whole time and was unusable: LL0013 rejected every correctly written one for having the
    ;; body it did not have.
    ;;
    ;; UNTYPED, and rest-only, on purpose. A declared arity is an ASSERTION, and p5's real signatures
    ;; are variadic almost everywhere (`fill` takes 1, 2, 3 or 4 arguments; so do `color` and `text`).
    ;; Declaring `[w h]` here would buy an arity check and pay for it with false LL0211s on correct
    ;; code. Typing this surface honestly is its own pass, with its own gate -- see STDLIB.md.
    ;; ================================================================================================

    ;; Canvas & rendering
    (fn :extern createCanvas [...args])
    (fn :extern background [...args])
    (fn :extern fill [...args])
    (fn :extern noFill [...args])
    (fn :extern noStroke [...args])
    (fn :extern strokeWeight [...args])

    ;; Shapes
    (fn :extern rect [...args])
    (fn :extern ellipse [...args])
    (fn :extern arc [...args])
    (fn :extern beginShape [...args])
    (fn :extern endShape [...args])
    (fn :extern curveVertex [...args])
    (fn :extern bezierVertex [...args])

    ;; Input
    (fn :extern keyIsDown [...args])
    (fn :extern mouseIsPressed [...args])
    (let :extern mouseX)
    (let :extern mouseY)

    ;; Text
    (fn :extern text [...args])
    (fn :extern textSize [...args])
    (fn :extern textAlign [...args])
    (fn :extern textFont [...args])
    (fn :extern loadFont [...args])

    ;; Drawing modes
    (fn :extern rectMode [...args])
    (fn :extern ellipseMode [...args])
    (fn :extern imageMode [...args])

    ;; Math & random
    ;; `map` is p5's, and it is deliberately NOT exported below: `std/seq` exports a `map` of
    ;; its own, and the importer must get THAT one. D20's module boundary is what makes keeping this
    ;; one private possible at all.
    (fn :extern map [...args])
    (fn :extern randomGaussian [...args])

    ;; Images
    (fn :extern loadImage [...args])
    (fn :extern noTint [...args])

    ;; Frame
    (fn :extern frameRate [...args])
    (let :extern frameCount)

    ;; Colour -- `color` is private for the same reason as `map`: `create-color` wraps it.
    (fn :extern colorMode [...args])
    (fn :extern color [...args])

    ;; The p5 namespace object itself (`p5.disableFriendlyErrors`).
    (let :extern p5)

    ;; The raw p5 names the sketch reaches for directly, rather than through a wrapper.
    (export createCanvas background fill rect ellipse arc text frameRate p5)

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
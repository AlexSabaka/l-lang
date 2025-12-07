(
    (fn create-canvas [width height]
        (createCanvas width height))

    (fn no-stroke []
        (call noStroke))

    (fn create-vector [x y]
        (return (createVector x y)))

    (fn * [vec scalar]
        (return (p5.Vector.mult vec scalar)))

    (fn • [vec1 vec2]
        (return (p5.Vector.dot vec1 vec2)))

    (fn / [vec scalar]
        (return (p5.Vector.div vec scalar)))

    (fn + [vec1 vec2]
        (return (p5.Vector.add vec1 vec2)))

    (fn - [vec1 vec2]
        (return (p5.Vector.sub vec1 vec2)))

    (export create-canvas no-stroke create-vector * • / + -)
)
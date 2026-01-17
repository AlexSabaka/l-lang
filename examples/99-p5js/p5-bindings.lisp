(
    (fn create-canvas [width height]
        (createCanvas width height))

    (fn no-stroke []
        (call noStroke))

    (fn create-vector [x y]
        (return (createVector x y)))


    (export create-canvas no-stroke)
)
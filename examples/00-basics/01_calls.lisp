(
    ;; 1. Immutable assignment
    (let pi 3.14159)

    ;; 2. Mutable assignment
    (mut counter 0)
    (counter := (+ counter 1))

    ;; 3. Math & String Interpolation
    (let radius 10)
    (let area (* pi (* radius radius)))

    (console.log '"Circle Area: {(area)}")
    (console.log '"Counter should be 1: {(counter)}")

    ;; 4. Nested expressions
    (let complex-calc 
        (/ (Math.log 100)
           (Math.sqrt 16))) ;; returns 0.5 * ln(100) approx 1.15

    (console.log complex-calc)
)
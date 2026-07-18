(
    ;; ============================================================
    ;; Vector toolkit — free functions over std/math's Vector3.
    ;; ============================================================
    ;; Extracted from examples/30-games/boids-p5/vec.lisp. std/math
    ;; ships `Vector3` (a 3D float value struct) with `.mag` and the
    ;; operators + - * / and · (dot). It does NOT ship normalize /
    ;; limit / set-mag / heading / dist — the pieces a flock steers
    ;; with — so the game adds them as plain prefix free functions.
    ;;
    ;; The idiom: a method-like `(normalize v)` is written as a free
    ;; function whose FIRST parameter is the receiver. `(dist a b)`
    ;; emits `dist(a, b)` no matter the argument shape — value-typed
    ;; in, a fresh value out, exactly like the struct's own operators.
    ;; (The game's report explains why `:extension` methods were the
    ;; wrong tool here: they mis-dispatch on a member-chain receiver.)
    ;; ============================================================
    (import "std/math")

    ;; Squared magnitude — a sqrt-free radius test.
    (fn mag-sq [v <- Vector3] -> Real
        (return (+ (* v.x v.x) (+ (* v.y v.y) (* v.z v.z)))))

    ;; Unit vector. A zero vector has no direction — return zero rather
    ;; than divide by zero and spray NaN everywhere.
    (fn normalize [v <- Vector3] -> Vector3
        (let m (v.mag))
        (if (== m 0.0) (return (new Vector3 0 0 0)))
        (return (/ v m)))

    ;; Clamp magnitude to `mx`, direction preserved.
    (fn limit [v <- Vector3 mx <- Real] -> Vector3
        (if (> (v.mag) mx) (return (* (normalize v) mx)))
        (return v))

    ;; Rescale to a chosen length.
    (fn set-mag [v <- Vector3 m <- Real] -> Vector3
        (return (* (normalize v) m)))

    ;; Euclidean distance between two points.
    (fn dist [a <- Vector3 b <- Vector3] -> Real
        (let d (- a b))
        (return (d.mag)))

    ;; Facing angle in radians. std/math has no atan2, so reach the
    ;; host `Math.atan2` global directly.
    (fn heading [v <- Vector3] -> Real
        (return (Math.atan2 v.y v.x)))

    ;; ---- formatting: round to 3 decimals so output is deterministic ----
    (fn r3 [x <- Real] -> Real
        (return (/ (Math.round (* x 1000.0)) 1000.0)))

    (fn vstr [v <- Vector3] -> String
        (return '"({(r3 v.x)},{(r3 v.y)},{(r3 v.z)})"))

    ;; ---- three fixed vectors ----
    (let a (new Vector3 3 4 0))
    (let b (new Vector3 1 2 2))
    (let zero (new Vector3 0 0 0))

    (console.log '"mag-sq {(vstr a)} -> {(r3 (mag-sq a))}")
    (console.log '"normalize {(vstr a)} -> {(vstr (normalize a))}")
    (console.log '"normalize {(vstr b)} -> {(vstr (normalize b))}")
    (console.log '"normalize {(vstr zero)} -> {(vstr (normalize zero))}")
    (console.log '"dist {(vstr a)} {(vstr b)} -> {(r3 (dist a b))}")
    (console.log '"limit {(vstr a)} 3 -> {(vstr (limit a 3))}")
    (console.log '"limit {(vstr a)} 10 -> {(vstr (limit a 10))}")
    (console.log '"set-mag {(vstr a)} 10 -> {(vstr (set-mag a 10))}")
    (console.log '"heading {(vstr a)} -> {(r3 (heading a))}")
    (console.log '"heading {(vstr b)} -> {(r3 (heading b))}")
)

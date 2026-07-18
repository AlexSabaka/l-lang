;; geometry/measure.lisp -- derived measurements over the shape types.
;;
;; The package's second file. It imports its own sibling explicitly rather than
;; leaning on any transitive visibility.
(
    (import "./shapes.lisp")
    (import "std/math")
    (import "std/seq")

    ;; NOT exported -- an implementation detail of this module. Leaving a name out of
    ;; `(export ...)` is what makes it private to the module (D20/LL0215); it is still
    ;; an ordinary function in here.
    (fn round2 [x <- Number] -> Number
        (return (/ (round (* x 100)) 100)))

    (fn diagonal [r <- Rect] -> Number
        (return (round2 (sqrt (+ (* r.w r.w) (* r.h r.h))))))

    (fn area-of [s] -> Number
        (return (round2 (s.area))))

    (fn total-area [rs] -> Int
        (return (reduce (fn [acc r] (return (+ acc (r.area)))) 0 rs)))

    (export diagonal area-of total-area)
)

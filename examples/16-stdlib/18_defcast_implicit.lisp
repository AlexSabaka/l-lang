;; `:implicit` conversions (D46/B-3) -- a `defcast` the compiler applies for you, at the three
;; coercion sites: a let-init, a return, and an assignment. Nothing below writes `(cast<Real> …)`.
;;
;; The rules are all refusals, and each one is exercised in 80-adversarial/:
;;   - `:explicit` NEVER fires here. That is the entire difference between the two kinds.
;;   - ONE HOP. `A -> B` and `B -> Real` do not combine into `A -> Real`; conversions never chain.
;;   - A SUBTYPE RELATION IS PREFERRED -- a conversion is consulted only once nothing else fits, so
;;     it can add assignability but never redirect an existing one through a user function.
;;   - An `:implicit` conversion may not target a refined newtype (LL0243), because entering one runs
;;     a range check that can panic, and that must not happen without being asked for.
(
    (defclass Celsius (let :ctor degrees <- Real))

    (defcast :implicit [c <- Celsius] -> Real c.degrees)

    (let temp (Celsius 21.5))

    ;; LET-INIT: the annotation is the destination.
    (let as-real <- Real temp)
    (console.log "let:" as-real)

    ;; RETURN: the declared return type is the destination, and the conversion happens on the way out.
    (fn unwrap [c <- Celsius] -> Real c)
    (console.log "return:" (unwrap (Celsius 3.5)))

    ;; ASSIGNMENT: the target's type is the destination.
    (mut slot <- Real 0.0)
    (slot := temp)
    (console.log "assign:" slot)

    ;; The converted value is an ordinary Real afterwards.
    (console.log "arithmetic:" (+ as-real slot))
)

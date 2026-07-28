;; ADVERSARIAL: arithmetic COMPOSES dimensions, and `+` refuses to cross them (D90).
;;
;; `(+ metres seconds)` printed `12` and `(/ metres seconds)` printed `5` -- both silent, both wrong.
;; R3 made a dimension declarable and checked it at ASSIGNMENT; this is the half that makes the feature
;; worth having, because a unit you cannot compute with is a comment.
;;
;; TWO RULES, AND ONLY TWO.
;;
;;   `+` `-`   the dimensions must be EQUAL, else LL0247.
;;   `*` `/`   COMPOSE -- exponents add and subtract. A dimensionless operand contributes the empty
;;             map, which is the identity, so `(* d 2.0)` is still a Meter.
;;
;; A PLAIN `Real` IS DIMENSIONLESS, NOT UNKNOWN, and that is the ruling with teeth. `(+ metres 2.0)` is
;; refused -- it is the Mars Climate Orbiter shape, and waving it through would leave the feature
;; catching almost nothing. It does NOT break construction: `(let d <- Meter 10.0)` is the author
;; DECLARING the unit at a boundary, and `<- Meter` is that declaration. Arithmetic is not.
;;
;; AND IT REACHES ONLY `:unit` TYPES, which is what makes that strictness affordable. This rule was
;; first written to apply to every refined newtype and broke five corpus files -- `(+ brightness 1)` on
;; a `uint8` is ordinary arithmetic on a bounded integer, and three of those lines are labelled
;; `"widened:"`. A range bounds a VALUE; `:unit` names a MEASUREMENT; a refinement's shape cannot tell
;; them apart, so the author does.
;;
;; THE COMPOSED TYPE HAS NO NAME AND NEEDS NONE. `(/ d t)` is `Real{Meter/Second}` -- a synthetic
;; nominal type carrying the map. It is never nameable, because assignability compares DIMENSIONS, not
;; names: that is what lets `(let v <- Speed (/ d t))` typecheck without anyone declaring what the
;; intermediate is called. Full F# would go one step further and let a FUNCTION be generic over units
;; (`fn sq<'u>`); that is the research half D88 ruled out, and this stops exactly short of it.
;;
;; EVERYTHING ELSE IS UNTOUCHED, deliberately. `(< metres seconds)` is the same category error, and so
;; arguably is `%`. But D88 ruled `+`/`-` and nothing else, and a rule invented here rather than ruled
;; is how a feature grows a surface nobody agreed to. Those are their own ruling; the roadmap says so.
(
    (deftype :unit Meter  <- Real)
    (deftype :unit Second <- Real)
    (deftype :unit Kg     <- Real)

    (deftype Speed  <- Real :satisfies (/ Meter Second))
    (deftype Accel  <- Real :satisfies (/ Meter (* Second Second)))
    (deftype Newton <- Real :satisfies (/ (* Kg Meter) (* Second Second)))

    (let d <- Meter  100.0)
    (let t <- Second   4.0)
    (let m <- Kg       3.0)

    ;; -- division composes, and the result lands in a unit nobody had to name en route ------------
    ;;
    ;; 100 m / 4 s = 25 m/s. The intermediate is `Real{Meter/Second}`; `Speed` accepts it because their
    ;; dimensions match, not because anything is called Speed.

    (let v <- Speed (/ d t))
    (console.log "speed:      " v)

    ;; 25 m/s / 4 s = 6.25 m/s^2. TWO hops -- the left operand is itself dimensioned, so `Second`'s
    ;; exponent goes to -2. A sign error here would be invisible in the number, which is why the
    ;; annotation is the test: `Accel` is `(/ Meter (* Second Second))` and nothing else fits.
    (let a <- Accel (/ v t))
    (console.log "accel:      " a)

    ;; F = m*a: 3 kg * 6.25 m/s^2 = 18.75 kg*m/s^2. MULTIPLICATION across two different dimensions,
    ;; which `+` forbids and `*` is for.
    (let f <- Newton (* m a))
    (console.log "force:      " f)

    ;; -- a dimensionless factor is the IDENTITY, which is what keeps scaling working ---------------
    ;;
    ;; Without it there would be no way to scale a measurement at all: `2.0` has no unit and never
    ;; could, so if a dimensionless operand poisoned `*` the way it poisons `+`, doubling a distance
    ;; would be unexpressible.

    (let twice <- Meter (* d 2.0))
    (console.log "scaled:     " twice)
    (let half  <- Meter (/ d 2.0))
    (console.log "halved:     " half)

    ;; -- same dimension adds, and keeps the unit ---------------------------------------------------

    (let total <- Meter (+ d twice))
    (console.log "sum:        " total)

    ;; -- and everything can cancel ------------------------------------------------------------------
    ;;
    ;; `(/ d d)` is a plain number: every exponent reaches zero and is deleted, so the answer is the
    ;; BASE type rather than a nominal type whose dimension is empty. Saying "Real" is more useful than
    ;; saying "Real{dimensionless}", and it means a ratio flows into ordinary arithmetic unimpeded.

    (let ratio (/ d d))
    (console.log "cancelled:  " ratio)
    (console.log "ratio + 1:  " (+ ratio 1.0))

    ;; -- the units erase, so all of the above is ordinary double arithmetic -------------------------
    ;;
    ;; A dimensioned newtype carries no bounds, and `ll_refine_check_*` is emitted FROM the bounds --
    ;; so this file emits none. Measured against its range-refined twin, which emits two.

    ;; -- what is refused, pinned in `test:diagnostics` (this file has to run) -----------------------
    ;;
    ;;   (+ d t)              -- LL0247, 'Meter' and 'Second'
    ;;   (+ d 2.0)            -- LL0247, 'Meter' and 'dimensionless'
    ;;   (let x <- Speed (* d t))  -- LL0200, Real{Meter*Second} is not Meter/Second
    (console.log "done")
)

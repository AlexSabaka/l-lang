;; UNITS OF MEASURE -- a `:satisfies` refinement that is a DIMENSION, not a range (D90).
;;
;; `(+ metres seconds)` printed `12`. Only the ASSIGNMENT boundary was nominal (`ELL0200 cannot assign
;; Second to Meter`); arithmetic was never checked at all, so the one class of bug units exist to catch
;; -- adding two quantities that are not the same kind of thing -- was silent. D88 recorded the ruling
;; and left it unbuilt; this is the declaration half.
;;
;; A UNIT IS DECLARED, AND THAT WAS RULED THE OTHER WAY FIRST. The cheaper rule -- "every refined
;; newtype is a base dimension", no new syntax -- was tried and MEASURED WRONG: it broke five corpus
;; files, three of them on lines labelled `"widened:"`. `(+ brightness 1)` where `brightness` is a
;; `uint8` is ordinary arithmetic on a bounded integer, not a category error, and a refinement's SHAPE
;; cannot tell that apart from `(+ metres 2.0)`. Both are nominal newtypes; only the author knows which
;; one names a MEASUREMENT. So `:unit` says it, and `uint8`/`Kelvin`/`Level` are untouched by every rule
;; on this page.
;;
;; A DIMENSION IS A TYPE-LEVEL TERM, not an expression, and the grammar says so. Parsing `(/ Meter
;; Second)` as an ordinary list would put `Meter` in the VALUE namespace for every pass that walks
;; generically -- `LL0210 'Meter' is not defined` at the first identifier check. `dimensionConstraint`
;; is its own rule, gated on `Star`/`Slash` as the token after the paren (a range constraint can never
;; begin with either), and its operands come back as plain STRINGS so nothing can walk into them.
;;
;; UNITS ERASE. A dimensioned newtype carries no bounds, and the runtime checks are emitted FROM the
;; bounds -- so it emits no `ll_refine_check_*` call site at all, where the range-refined twin of this
;; file emits two. Measured, not assumed. (A refined newtype's parameter is boxed either way; that is
;; pre-existing and has nothing to do with dimensions.)
(
    ;; -- base units --------------------------------------------------------------------------------
    ;;
    ;; `:unit` makes the newtype NOMINAL on its own, so no `:satisfies` is needed to make it distinct.
    ;; A unit MAY still carry a range -- `(deftype :unit Kelvin <- Real :satisfies (0.0 ..))` is a
    ;; measurement with a floor, and gets both the dimension rules and the runtime bounds check.

    (deftype :unit Meter  <- Real)
    (deftype :unit Second <- Real)
    (deftype :unit Kg     <- Real)

    ;; -- derived units -----------------------------------------------------------------------------
    ;;
    ;; `(* a b)` adds exponents; `(/ a b c)` divides by everything AFTER the first -- the same reading
    ;; `(- 10 1 2)` already has. So `Newton` is kg*m/s^2 and `Watt` is kg*m^2/s^3.

    (deftype Speed  <- Real :satisfies (/ Meter Second))
    (deftype Accel  <- Real :satisfies (/ Meter (* Second Second)))
    (deftype Newton <- Real :satisfies (/ (* Kg Meter) (* Second Second)))
    (deftype Watt   <- Real :satisfies (/ (* Kg Meter Meter) (* Second Second Second)))

    ;; -- construction is unchanged -----------------------------------------------------------------
    ;;
    ;; A bare `Real` binding to a dimensioned type is still a checked coercion (D46), because `<- Meter`
    ;; is the author DECLARING the unit at a boundary. That is the only way to make one, and arithmetic
    ;; is a different act -- which is why `(+ d 2.0)` is refused and this is not.

    (let d <- Meter  10.0)
    (let t <- Second  2.0)
    (let p <- Watt   60.0)
    (console.log "distance:" d)
    (console.log "time:    " t)
    (console.log "power:   " p)

    ;; -- A DIMENSION IS THE IDENTITY, NOT THE NAME -------------------------------------------------
    ;;
    ;; `Velocity` is declared separately and never mentions `Speed`, yet the two are mutually assignable:
    ;; they measure the same thing. This is the whole behavioural difference R3 buys -- before it, two
    ;; nominal newtypes were distinct unless their NAMES matched, so a library's `Speed` and an
    ;; application's `Velocity` could never meet without a cast.

    (deftype Velocity <- Real :satisfies (/ Meter Second))
    (let v <- Speed    5.0)
    (let u <- Velocity v)
    (console.log "speed as velocity:" u)

    ;; -- and the algebra REDUCES, so the spelling does not have to match ---------------------------
    ;;
    ;; `(/ (* Meter Second) Second)` normalizes to `{Meter: 1}`: an exponent that reaches zero is
    ;; deleted, so this is `Meter` and takes a Meter. A unit is its normal form, not its source text.

    (deftype MeterAgain <- Real :satisfies (/ (* Meter Second) Second))
    (let m <- MeterAgain d)
    (console.log "reduced to Meter:" m)

    ;; -- what is still an error, unchanged ---------------------------------------------------------
    ;;
    ;; Different dimensions do not meet. Pinned in `test:diagnostics` (this file has to run):
    ;;   (let bad <- Speed d)                          -- LL0200, Meter is not Meter/Second
    ;;   (deftype Bad <- Real :satisfies (/ Meter Metre))  -- LL0248, `Metre` is not a unit
    ;;   (deftype Loop <- Real :satisfies (/ Loop Meter))  -- LL0248, circular
)

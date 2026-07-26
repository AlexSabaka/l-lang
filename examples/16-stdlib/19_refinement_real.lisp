;; Real-based refined newtypes (D46 amend). Until now a `:satisfies` range over `Real` kept its
;; NOMINAL distinctness -- a Kelvin was never a Meter -- but its bounds were not enforced; only
;; Int-based ones were checked.
;;
;; Real gets its own floor check rather than sharing the Int one: the value and both bounds are
;; doubles, and routing them through the Int signature would truncate the very bound being tested.
;; Everything else is shared -- the same coercion point, the same boundaries, the same message.
(
    (deftype Ratio  <- Real :satisfies (0.0 .. 1.0))
    (deftype Kelvin <- Real :satisfies (0.0 ..))       ;; open-ended: absolute zero and up

    ;; let-init
    (let r <- Ratio 0.75)
    (console.log "let:" r)

    ;; open-ended, checked on the closed side only
    (let k <- Kelvin 273.15)
    (console.log "open-ended:" k)

    ;; parameter and return
    (fn halve [x <- Ratio] -> Ratio (/ x 2.0))
    (console.log "param+return:" (halve 0.5))

    ;; assignment
    (mut level <- Ratio 0.1)
    (level := 0.9)
    (console.log "assign:" level)

    ;; a `:ctor` field
    (defclass Mix (let :ctor wet <- Ratio))
    (let m (Mix 0.25))
    (console.log "field:" m.wet)

    ;; and it still widens to its base for arithmetic
    (console.log "widened:" (+ r 1.0))
)

;; A REST parameter inside a lifted closure, on the native backend.
;;
;; `(fn [...args] …)` worked as a top-level function and silently did not as a CLOSURE. The asymmetry
;; has a cause worth keeping: a top-level function's rest parameter is packed by the CALL SITE, which
;; knows the arity. A closure is reached through the boxed convention with a flat argument array, so
;; there is no such site — nothing packed it, and the parameter received ONE argument where the body
;; expected a vector. It surfaced as `TypeError: expected a Vector` the moment anything asked for
;; `args.length`, which is to say: not until a decorator was written.
;;
;; This is the shape every `defmodifier` decorator body has, which is how it was found.
(
    ;; The plain case: a closure that collects everything.
    (fn make-counter [] (return (fn [...args] (return args.length))))
    (let count (make-counter))
    (console.log "collects:" (count 1 2 3))
    (console.log "none:" (count))

    ;; FIXED PARAMETERS FIRST, then the rest. The offset is what makes this more than a copy.
    (let head-and-rest (fn [first <- Int ...rest] (return [first rest.length])))
    (console.log "after one fixed:" (head-and-rest 10 20 30))

    ;; CALLED WITH FEWER ARGUMENTS THAN THE FIXED PARAMETERS. A closure may legally be, so the count
    ;; is clamped rather than trusted — an unclamped subtraction would give a negative length here.
    (console.log "short call:" (head-and-rest 10))

    ;; And the whole decorator shape, which is what all of this was for: a wrapper that collects its
    ;; arguments, logs them, and spreads them back into the original.
    (fn add [a <- Int b <- Int] -> Int (+ a b))

    (fn wrap [original] (
        (return (fn [...args] (
            (console.log "  [log] call:" args)
            (let result (original ...args))
            (console.log "  [log] result:" result)
            (return result)
        )))
    ))

    (let logged-add (wrap add))
    (console.log "wrapped:" (logged-add 5 3))
)

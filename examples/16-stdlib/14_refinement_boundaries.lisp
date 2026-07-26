;; The PARAMETER and RETURN boundaries of a `:satisfies` refinement (D46 amend, P3c-1c-ii). Until
;; this, only `(let x <- uint8 …)` was checked, so a function taking a `uint8` accepted anything.
;;
;; A parameter is checked by a PROLOGUE -- one check per function, so every caller is covered, not
;; just the ones a signature lookup could find. A return is checked at each explicit `(return e)` AND
;; at the tail expression, including the tail of an `if` branch, because the check lands wherever
;; codegen would have put the implicit return.
;;
;; Every value here is IN range: the sad paths panic, and live in 80-adversarial/.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))
    (deftype Level <- Int :satisfies (1 ..))          ;; open-ended: 1 and up

    ;; PARAMETER: checked on entry, whatever the call site looked like.
    (fn scale [x <- uint8 factor <- Int] -> Int (* x factor))
    (console.log "param:" (scale 12 3))

    ;; RETURN, explicit.
    (fn clamp-high [n <- Int] -> uint8 (
        (if (> n 255) (return 255))
        (return n)
    ))
    (console.log "explicit return:" (clamp-high 300) (clamp-high 7))

    ;; RETURN, implicit tail -- no `return` written anywhere.
    (fn double-it [n <- Int] -> uint8 (* n 2))
    (console.log "implicit tail:" (double-it 100))

    ;; RETURN, implicit through an `if`: the check goes on each BRANCH, not around the `if`.
    (fn pick [big <- Boolean] -> uint8 (if big 200 5))
    (console.log "implicit if:" (pick true) (pick false))

    ;; An open-ended bound is checked on one side only.
    (fn level-of [n <- Int] -> Level (+ n 1))
    (console.log "open-ended:" (level-of 41))

    ;; A refined value flowing back OUT widens to its base for arithmetic.
    (let total <- Int (+ (scale 2 4) (double-it 3)))
    (console.log "total:" total)
)

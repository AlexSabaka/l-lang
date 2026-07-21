(
    (let x 3)
    (let y
        (match x {
            1 => ("1 1 1 1")
            2 => ("2 2 2 2")
            3 => ("3 3 3 3")
            4 => ("4 4 4 4")
            _ => ('"{(x)} LOL {(x)}")
            }))
    (console.log y)

    ;; Guards (D26): `pattern :when expr`. The pattern binds `n`, the guard tests it.
    ;;
    ;; This file used to write these as `(< _ 0)` -- which does NOT parse as a guard. `(< _ 0)` is a
    ;; three-element list-pattern `[<, _, 0]`, so every arm fell through, and the golden recorded that
    ;; fall-through -- `how da fck are you still alive?` -- as the expected answer. A passing test that
    ;; asserted a bug.
    ;;
    ;; `Math.random` takes no arguments and returns [0, 1), so `n` is always in [0, 1): `(< n 0)` is
    ;; false and `(< n 10)` is true. The second arm wins, deterministically.
    ;; `(Math.random)`, no arguments -- it never took any. JS ignores extras silently, and the
    ;; `std/js` extern was untyped, so nothing could say so until the intrinsic floor (D50) gave the
    ;; name a real signature. The comment above has described the correct behaviour all along.
    (match (Math.random)
        {
            n :when (< n 0)  => (console.log "unborn")
            n :when (< n 10) => (console.log "just a baby")
            n :when (< n 20) => (console.log "yo yo yo a teenager here")
            n :when (< n 40) => (console.log "nothing spectacular a middleage person")
            n :when (< n 60) => (console.log "i see youve seen some shit in life")
            n :when (< n 90) => (console.log "have you bought yourself a place at graveyard?")
            _                => (console.log "how da fck are you still alive?")
        }
    )
)

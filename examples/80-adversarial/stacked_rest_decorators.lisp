;; ADVERSARIAL: A `[...rest]` PARAMETER IS PACKED BY WHOEVER KNOWS THE ARITY -- AND SOMETIMES THAT IS
;; THE CALLEE.
;;
;; A direct call site packs the vector itself, because it can see how many arguments there are. The
;; BOXED convention cannot: `ll_call` hands the callee a flat `(argc, argv)` and no site in between
;; ever built a vector. So a function with a rest parameter, reached as a VALUE, has to collect its
;; own -- which the lifted-closure prologue already did, and the top-level-function ADAPTER did not.
;; It read `__argv[restAt]` as though the vector were already sitting there.
;;
;; THAT IS WHAT MADE STACKED DECORATORS TRAP. D75 unfolds each layer into an ordinary C function
;; taking one packed `ll_vec*`, and binds the next layer's `original` as a closure VALUE. So the
;; OUTERMOST layer is called directly -- packed by its call site, fine -- and every layer beneath it
;; is reached through the adapter. Measured before the fix:
;;
;;     one decorator    ->  works
;;     two decorators   ->  `TypeError: expected a Vector`, with the outer's log line ALREADY PRINTED
;;
;; Which is the tell: the failure is not in the decorator that traps, it is in how it was CALLED.
;;
;; This is the third time in this file's neighbourhood that one convention was taught a rule and its
;; sibling was not -- the rest clamp existed in the closure prologue while three fixed-parameter reads
;; beside it trusted `__argc`, and now the packing existed there while the adapter did not.
(
    ;; -- three layers, each reporting what it was handed ---------------------------------------------
    ;;
    ;; Modifiers apply in SOURCE ORDER, innermost first, so the RIGHTMOST ends up OUTERMOST and logs
    ;; first. Only the outermost is called directly; `b` and `a` are both reached through the adapter,
    ;; so a fix that repaired only the first hop would stop after `b`.

    (defmodifier a []
        (fn [original ...args]
            (console.log "  a sees" args.length "args:" args)
            (original ...args)))
    (defmodifier b []
        (fn [original ...args]
            (console.log "  b sees" args.length "args:" args)
            (original ...args)))
    (defmodifier c []
        (fn [original ...args]
            (console.log "  c sees" args.length "args:" args)
            (original ...args)))

    (fn :a :b :c three [x <- Int y <- Int z <- Int] -> Int (+ x (+ y z)))
    (console.log "three:" (three 1 2 3))

    ;; `args.length` is the assertion that matters here, not the printed vector: the trap was raised by
    ;; `ll_unbox_vec` on an Int, so a packing that produced a vector of the WRONG LENGTH would still
    ;; print something vector-shaped and still be wrong.

    ;; -- a decorator with a FIXED parameter, stacked under a rest one -------------------------------
    ;;
    ;; `doubled` takes `[original n]` and forwards a changed value, so this pins that the adapter did
    ;; not simply start packing everything: the fixed parameter still reads one argument, and the value
    ;; that reaches the body is the modified one.

    (defmodifier doubled []
        (fn [original n] (original (* n 2))))
    (fn :doubled :a scaled [n <- Int] -> Int (* n 10))
    (console.log "scaled:" (scaled 5))

    ;; -- and a NULLARY function under a rest decorator ----------------------------------------------
    ;;
    ;; The clamp, at its edge: `__argc` is 0 and the rest must be an EMPTY vector rather than a
    ;; negative length. `call` is the only spelling of a no-argument invocation (D1), and it is the
    ;; same call that passes a NULL argv -- so this line leans on the adapter's bounds guard too.

    (fn :a nullary [] -> Int 42)
    (console.log "nullary:" (call nullary))
    (console.log "done")
)

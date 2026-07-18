;; A logging modifier -- one that actually logs.
;;
;; A `defmodifier` BODY evaluates to a DECORATOR: a function taking the original function and
;; returning its replacement. Before D3b the body was discarded and every modifier emitted the same
;; canned memoizer -- so this file declared `(defmodifier logged [])`, logged nothing at all, and its
;; golden (recorded from that output, not authored from intent) contained no log lines.

(
    ;; Logging modifier that logs function calls and results
    (defmodifier logged []
        (fn [original]
            (fn [...args]
                (console.log "[log] call:" args)
                (let result (original ...args))
                (console.log "[log] result:" result)
                result)))

    ;; Simple math function with logging
    (fn :logged add [a <- Int, b <- Int] -> Int
        (+ a b)
    )

    ;; Simple double function with logging
    (fn :logged double [x <- Int] -> Int
        (+ x x)
    )

    ;; Test the logged functions
    (console.log "Testing logged functions:")
    (console.log "5 + 3 =" (add 5 3))
    (console.log "double 7 =" (double 7))
    (console.log "2 + 8 =" (add 2 8))
)

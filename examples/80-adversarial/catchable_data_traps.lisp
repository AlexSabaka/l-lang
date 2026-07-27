;; A DATA ERROR IS CATCHABLE; A CONTRACT VIOLATION IS NOT.
;;
;; `ll_trap` on C was `fprintf` + `exit(70)` unconditionally, so an index out of bounds KILLED the
;; process while the same program on JS threw an ordinary `Error` a `catch` could handle. That is a
;; backend divergence in the one direction nothing else covers: not a wrong answer, but a program that
;; runs on one target and dies on the other, with the corpus reporting only "exit code 70".
;;
;; THE LINE, ruled rather than discovered:
;;
;;   * an INDEX is DATA the program received -- it can be wrong for reasons the author cannot see from
;;     the source, so the program is allowed to handle it;
;;   * a REFINEMENT is a CONTRACT the author declared -- `(deftype uint8 <- Int :satisfies (0 .. 255))`
;;     is a promise, and breaking it is a bug in the program rather than an input it can recover from.
;;     It still panics (D46 amend / P3c-1b-ii), and `refinement_panic.lisp` pins that it does.
;;
;; The split needed no enforcement: `ll_refine_check_int`/`_real` do their own `exit(1)` and never
;; route through `ll_trap`, so they were already on the other side of it.
;;
;; The kind string IS the class name, so there is no mapping table: the D62 tower declares
;; `RangeError`, `TypeError`, `ValueError` and `KeyError` as l-lang classes and the runtime looks up
;; whichever one the trap named. A kind with no class stays fatal rather than being reported as
;; something it is not.
(
    ;; -- an out-of-range index is catchable, and catchable BY TYPE -------------------------------

    (fn at [xs <- Int[] i <- Int] -> Int (
        (try (return xs[i])
         catch e :of RangeError (return -1))
    ))

    (let xs [10 20 30])
    (console.log "in range: " (at xs 1))
    (console.log "past end: " (at xs 99))
    (console.log "negative: " (at xs -5))

    ;; The error is a REAL instance of the tower's class, not a stand-in -- so a broad handler catches
    ;; it through `:extends`, which is the whole reason it is worth constructing the right class.
    (fn broad [xs <- Int[] i <- Int] -> String (
        (try ((let v xs[i]) (return "ok"))
         catch e :of Error (return (e.message)))
    ))
    (console.log "as Error:" (broad xs 99))

    ;; -- an UNCAUGHT trap still ends the program ---------------------------------------------------
    ;;
    ;; Making a trap catchable must not make it survivable by default. With no handler installed the
    ;; runtime exits exactly as it always did, message intact -- which is also what keeps the failure
    ;; legible when there is nothing to catch it.
    ;;
    ;; Not exercised here: this file has to finish. `refinement_panic.lisp` covers the fatal shape.

    ;; -- the handler runs at the right depth --------------------------------------------------------
    ;;
    ;; The trap unwinds through the SAME machinery `throw` uses, so an intervening frame's `finally`
    ;; runs on the way out. A trap that longjmp'd straight to the handler would skip it.

    (fn with-cleanup [xs <- Int[] i <- Int] -> String (
        (try
            (try ((let v xs[i]) (return "no error"))
             finally (console.log "  cleanup ran"))
         catch e :of RangeError (return "caught outside"))
    ))
    (console.log "nested:  " (with-cleanup xs 99))

    ;; -- a caught trap leaves the program usable ---------------------------------------------------
    ;;
    ;; The point of catchability: execution continues normally afterwards, including further traps.

    (console.log "after:   " (at xs 0) (at xs 42) (at xs 2))
)

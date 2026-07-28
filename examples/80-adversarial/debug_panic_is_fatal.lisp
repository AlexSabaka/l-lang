;; ADVERSARIAL: `std/debug`'s panic family ENDS THE PROCESS. It is not catchable.
;;
;; `unreachable`, `todo` and `unimplemented` used to `throw (FatalError ...)`. FatalError extends Error
;; like everything else in the D62 tower, so `catch :of Error` CAUGHT IT -- and "this cannot happen"
;; quietly became "this was counted as a recoverable failure and execution continued". A broad handler
;; anywhere up the stack silently converted a program defect into a handled condition.
;;
;; THE RULE is D85's, extended: a CONTRACT the author declared is not data to recover from. An index is
;; data the program received, so it is catchable; a refinement, a zero divisor, and an assertion about
;; the program's own state are claims the author made, so they end the program.
;;
;; `std/test`'s `assert` is DIFFERENT, and deliberately so rather than by oversight: its entire job is
;; to be caught. `run-tests` catches `:of Error`, counts the failure, and runs the next test -- an
;; assertion that panicked would abort the run on the first failure and report nothing. A test
;; assertion is a MEASUREMENT the framework collects; a debug assertion is a claim the program makes
;; about itself. Two different things that happen to share a name.
;;
;; Written in l-lang, not as a floor entry: stderr plus a non-zero exit is already expressible, and
;; nothing can catch a process that has exited. No new runtime surface, and both backends agree
;; because both already have `write-string-err` and `exit`.
(
    (import "std/debug")

    ;; -- a TRUE assertion is invisible -------------------------------------------------------------
    ;;
    ;; The guard that the panic path did not become an unconditional one: an assertion that holds must
    ;; cost nothing observable and must not print.

    (assert true "this holds")
    (assert (== (+ 2 2) 4) "arithmetic still works")
    (console.log "passed assertions are silent")

    ;; -- the panic is NOT catchable, which is the whole finding --------------------------------------
    ;;
    ;; A broad `catch :of Error` sits directly around it. Under the old FatalError spelling this
    ;; printed "caught" and carried on; now the process ends inside the try and the handler never runs.
    ;; The `.panic` golden is what asserts that -- if this ever becomes catchable again, the lines
    ;; after it appear in stdout and the file fails.

    (try ((assert false "deliberately false"))
     catch e :of Error (console.log "CAUGHT -- the panic became catchable again"))

    (console.log "UNREACHABLE -- execution continued past a panic")
)

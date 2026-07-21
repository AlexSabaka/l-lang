;; D47: a RESTART unwind is not a throw. ll_unwind runs every intervening CLEANUP frame (`finally`) on
;; the way to the restart, but SKIPS the CATCH frames -- transferring to a restart must never look like
;; an exception to intervening code. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: invoke-restart :go walks out of the try; the CLEANUP frame runs `finally`, the
;; CATCH frame is passed over, and the arm binds v=5. Expected: finally then 5.
(
    (fn f [] -> Int (
        (restart-case
            (try (invoke-restart :go 5)
                 catch e (console.log "CATCH FIRED -- BUG")
                 finally (console.log "finally"))
            (:go [v] v))
    ))
    (console.log (f))
)

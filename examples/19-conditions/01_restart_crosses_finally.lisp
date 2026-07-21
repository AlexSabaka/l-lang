;; D47 hard part (composes Cr-0 + Cr-1a): a restart transfer must run intervening `finally` blocks. Here a
;; direct invoke-restart inside a try/finally, nested in a restart-case, unwinds to the restart frame --
;; the try's CLEANUP frame is passed on the way, so `cleanup` runs before the arm. C-native; JS refuses.
;;
;; Hand-derived from D47: invoke-restart :skip -> ll_unwind(RESTART) walks out; the inner try's CLEANUP
;; frame runs `cleanup`, the pad resumes toward the restart frame, arm binds v=0. Expected: cleanup then 0.
(
    (fn f [] -> Int (
        (restart-case
            (try (invoke-restart :skip 0) finally (console.log "cleanup"))
            (:skip [v] v))
    ))
    (console.log (f))
)

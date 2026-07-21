;; A `return` out of a handle body must POP the LL_HANDLER frame (restore ll_handler_top) -- the emitter's
;; tryStack discipline. A leaked frame is not a crash but something worse: a later signal finds a stale
;; handler (its fn pointer and heap env are still valid) and silently runs dead code. C-native; JS refuses.
;;
;; Hand-derived from D47: `(return 7)` exits f through the frame, popping it; the signal AFTER f returns
;; then walks an empty handler stack -> nil. Expected: 7 then null (never "STALE HANDLER -- BUG").
(
    (defclass Alert :extends Error (let :ctor message))
    (fn f [] -> Int (
        (handle
            ((return 7))
            (:on Alert [] (console.log "STALE HANDLER -- BUG")))
        (return 9)
    ))
    (console.log (f))
    (console.log (signal (Alert "after")))
)

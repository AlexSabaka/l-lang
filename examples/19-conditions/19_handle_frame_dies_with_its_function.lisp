;; A handle frame lives in its enclosing C frame. Once that function returns normally, the frame must be
;; off the handler stack -- a leaked one would still hold a valid function pointer and a heap env, so a
;; later signal would silently run a handler whose scope is gone. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: `guarded` completes and pops its frame; the signal afterwards walks an empty
;; handler stack -> nil. Expected: inside then null (never "STALE -- BUG").
(
    (defclass Alert :extends Error (let :ctor message))
    (fn guarded [] (
        (handle
            ((console.log "inside"))
            (:on Alert [] (console.log "STALE -- BUG")))
    ))
    (guarded)
    (console.log (signal (Alert "after")))
)

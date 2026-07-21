;; A signal raised from INSIDE a `finally`: by the time the finalizer runs, the emitted pad has already
;; restored ll_handler_top to the CLEANUP frame's prev, so the walk sees the enclosing handle (and not
;; the half-torn-down try). C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: the try body prints `done` and completes normally; the finalizer then signals,
;; the enclosing handler runs in place and declines, so the signal yields nil.
;; Expected: done, handler, null.
(
    (defclass Alert :extends Error (let :ctor message))
    (handle
        ((try (console.log "done")
              finally (console.log (signal (Alert "in-finally")))))
        (:on Alert [] (console.log "handler")))
)

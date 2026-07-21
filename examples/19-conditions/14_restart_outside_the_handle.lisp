;; D47: the restart a handler picks need not be inside the handle -- here it is OUTSIDE, so the transfer
;; unwinds THROUGH the LL_HANDLER frame (skipped: a handler frame is never a longjmp landing) and the
;; handle's own pop never executes. Probes that an abandoned handler frame corrupts nothing. C-native.
;;
;; Hand-derived from D47: the clause invoke-restarts :out; the unwind crosses ll_signal's re-arm pad and
;; the handle frame, landing at the restart-case that ENCLOSES the handle, binding v=3. The statement
;; after the signal never runs. Expected: 3.
(
    (defclass Alert :extends Error (let :ctor message))
    (fn f [] -> Int (
        (restart-case
            (handle
                ((console.log (signal (Alert "x")))
                 (console.log "unreached"))
                (:on Alert [] (invoke-restart :out 3)))
            (:out [v] v))
    ))
    (console.log (f))
)

;; D47: a handler runs in the SIGNAL's dynamic context, not the handle's. So a `throw` from a handler
;; propagates outward FROM THE SIGNAL POINT -- cleanups between the signal and the handler run, and the
;; LL_HANDLER frame itself is not a landing (it is skipped like any non-catch frame). C-native; JS refuses.
;;
;; Hand-derived from D47: the clause throws; ll_unwind starts at the signal point, so the inner try's
;; CLEANUP runs `inner finally`; the handle frame is skipped; the catch OUTSIDE the handle catches. The
;; statement after the signal never runs. Expected: inner finally then outer catch.
(
    (defclass Alert :extends Error (let :ctor message))
    (fn f [] (
        (try
            (handle
                ((try ((console.log (signal (Alert "x"))) (console.log "unreached"))
                      finally (console.log "inner finally")))
                (:on Alert [] (throw (Error "from handler"))))
            catch e (console.log "outer catch"))
    ))
    (f)
)

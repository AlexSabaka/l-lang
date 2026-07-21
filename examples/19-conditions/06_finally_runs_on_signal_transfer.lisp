;; D47 hard part, fully composed (Cr-0 + Cr-1a + Cr-1b): a handler's invoke-restart transfer must run
;; every intervening `finally` on its way from the signal point to the restart frame -- including
;; ll_signal's own re-arm pad, which the transfer crosses first. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: signal -> the handle clause runs IN PLACE -> invoke-restart :skip 9 ->
;; ll_unwind crosses the signal pad (re-arm), then the try's CLEANUP frame (prints `cleanup`), then
;; lands at the restart arm binding v=9 -> the restart-case (and the handle body) yields 9. The
;; statements after the signal never run (`unreached` must NOT print). Expected: cleanup then 9.
(
    (defclass Alert :extends Error (let :ctor message))
    (fn f [] -> Int (
        (handle
            ((restart-case
                (try
                    ((console.log (signal (Alert "x")))
                     (console.log "unreached"))
                    finally (console.log "cleanup"))
                (:skip [v] v)))
            (:on Alert [] (invoke-restart :skip 9)))
    ))
    (console.log (f))
)

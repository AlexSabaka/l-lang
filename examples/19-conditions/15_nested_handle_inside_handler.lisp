;; D47 composition: a handler body may install its OWN handle and signal a different condition, so two
;; re-arm pads and two LL_HANDLER frames are live on one C stack. The inner handler then transfers all
;; the way out to a restart established before either handle. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: signal Alert -> outer clause prints and installs a nested handle -> signal Warn
;; -> inner clause prints and invoke-restarts :done 42 -> the unwind crosses inner pad, inner handler
;; frame, outer pad, outer handler frame (all skipped or re-armed) and lands at the restart arm binding
;; v=42. Expected: outer handler, inner handler, 42.
(
    (defclass Alert :extends Error (let :ctor message))
    (defclass Warn :extends Error (let :ctor message))
    (fn f [] -> Int (
        (restart-case
            (handle
                ((signal (Alert "a")) 1)
                (:on Alert []
                    (console.log "outer handler")
                    (handle
                        ((signal (Warn "w")))
                        (:on Warn [] (console.log "inner handler") (invoke-restart :done 42)))))
            (:done [v] v))
    ))
    (console.log (f))
)

;; D47 decline semantics: a handler that RETURNS declines -- its value is discarded and the walk
;; continues at the next OUTER frame; when every handler declines, `signal` yields nil. One clause per
;; frame runs (first-written matching `:on` wins). C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: the signal walks innermost->outermost. The inner frame matches -> prints
;; `inner`, falls off the end (decline); the outer frame matches -> prints `outer`, declines; no more
;; frames -> nil (prints `null`). Expected: inner, outer, null.
(
    (defclass Alert :extends Error (let :ctor message))
    (handle
        ((handle
            ((console.log (signal (Alert "x"))))
            (:on Alert [] (console.log "inner"))))
        (:on Alert [] (console.log "outer")))
)

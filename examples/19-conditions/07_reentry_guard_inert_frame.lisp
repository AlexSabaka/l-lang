;; D47 re-entry guard: a handler runs with its OWN frame inert (`active` -- simplified from CL: only
;; this frame; handlers inner to it stay eligible), so a re-signal of the same condition type from
;; inside the handler cannot re-enter it (no infinite loop) -- it finds no other handler and yields
;; nil. The frame re-arms when the handler declines. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: outer signal -> clause prints `handler`; the inner signal skips the inert
;; frame -> nil (prints `null`); the clause declines -> the outer signal yields nil (prints `null`);
;; the body continues (prints `resumed`). Expected: handler, null, null, resumed.
(
    (defclass Alert :extends Error (let :ctor message))
    (handle
        ((console.log (signal (Alert "one")))
         (console.log "resumed"))
        (:on Alert []
            (console.log "handler")
            (console.log (signal (Alert "two")))))
)

;; D47: an UNHANDLED signal is NOT an error -- with no handle installed, `signal` walks an empty handler
;; stack, returns nil, and execution continues. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: no LL_HANDLER frame exists -> all-decline -> signal yields nil (prints `null`),
;; then the next statement runs. Expected: null then continued.
(
    (defclass Ping :extends Error (let :ctor message))
    (console.log (signal (Ping "x")))
    (console.log "continued")
)

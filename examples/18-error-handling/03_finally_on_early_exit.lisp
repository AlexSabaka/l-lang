;; `finally` must run on EVERY exit from the `try` body -- including an early `return` (D12/D47).
;;
;; Regression guard for the Phase-0 finally-drop fix. Before it, the C backend emitted the finalizer
;; only after the setjmp if/else, so a `return` inside the try jumped clean past it -- `cleanup` was
;; dropped and the handler frame left unpopped. The fix routes every `return` through its enclosing
;; finalizers inline and restores ll_handler_top on the way out (EmitCirToC; no runtime rework). JS
;; always ran the finally (native try/finally). Expected: "cleanup" THEN "42".
(
    (fn f [] -> Int (try (
        (return 42)
    )
    finally (
        (console.log "cleanup")
    )))
    (console.log (f))
)

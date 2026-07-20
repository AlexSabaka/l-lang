;; `finally` must run on EVERY exit from the `try` body -- including an early `return` (D12/D47).
;;
;; RED on the C backend today (a KNOWN bug the checkpoints workflow surfaced): a `return` inside the
;; try jumps out of the function before the inline finalizer, so `cleanup` is dropped and the handler
;; frame is left unpopped. JS runs the finally correctly. The fix is the restart Phase-0 unwind rework
;; (ll_unwind runs intervening finalizers on throw / return / break-continue uniformly) -- until it
;; lands this file is JS-only (unlisted for the C ratchet). Expected: "cleanup" THEN "42".
(
    (fn f [] -> Int (try (
        (return 42)
    )
    finally (
        (console.log "cleanup")
    )))
    (console.log (f))
)

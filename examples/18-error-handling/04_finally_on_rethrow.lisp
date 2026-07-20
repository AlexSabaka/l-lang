;; `finally` must run when an exception propagates THROUGH a try that has no matching catch (D12/D47).
;;
;; RED on the C backend today: the catch-chain's no-match leaf rethrows (`ll_throw`) without running
;; the finalizer, so a finally-only `try` drops its cleanup while an exception unwinds past it. JS runs
;; it correctly (native try/finally). Expected: the inner "cleanup" THEN the outer handler.
(
    (fn f [] (
        (try (
            (throw (Error "boom"))
        )
        finally (
            (console.log "cleanup")
        ))
    ))
    (try (
        (f)
    )
    catch e (
        (console.log "outer caught")
    ))
)

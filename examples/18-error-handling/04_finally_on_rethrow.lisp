;; `finally` must run when an exception propagates THROUGH a try that has no matching catch (D12/D47).
;;
;; Regression guard (Phase-0 finally-drop fix). Before it, the catch-chain's no-match leaf rethrew
;; (`ll_throw`) without running the finalizer, so a finally-only `try` dropped its cleanup while an
;; exception unwound past it. The fix runs the frame's finalizer before rethrowing. JS always ran it
;; (native try/finally). Expected: the inner "cleanup" THEN the outer handler.
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

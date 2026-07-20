;; `finally` must run when a `catch` body itself `return`s (D12/D47).
;;
;; Regression guard (Phase-0 finally-drop fix). Before it, the `return` inside the catch jumped out of
;; the function before the trailing finalizer, dropping "cleanup". The fix routes a catch-body `return`
;; through the finalizer too. JS always ran it on the way out. Expected: "cleanup" THEN the value 7.
(
    (fn f [] -> Int (
        (try (
            (throw (Error "boom"))
        )
        catch e (
            (return 7)
        )
        finally (
            (console.log "cleanup")
        ))
    ))
    (console.log (f))
)

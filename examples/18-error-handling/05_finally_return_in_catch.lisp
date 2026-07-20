;; `finally` must run when a `catch` body itself `return`s (D12/D47).
;;
;; RED on the C backend today: the `return` inside the catch jumps out of the function before the
;; inline finalizer, dropping "cleanup". JS runs the finally on the way out. Expected: "cleanup" THEN
;; the returned value 7.
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

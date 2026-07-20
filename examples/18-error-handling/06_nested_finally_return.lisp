;; A `return` crossing two nested `try...finally` levels must run BOTH finalizers, inner before outer
;; (D12/D47).
;;
;; RED on the C backend today: the `return` jumps straight out of the function, dropping both cleanups.
;; JS runs them inner-to-outer. Expected: "inner" THEN "outer" THEN the returned value 99.
(
    (fn f [] -> Int (
        (try (
            (try (
                (return 99)
            )
            finally (
                (console.log "inner")
            ))
        )
        finally (
            (console.log "outer")
        ))
    ))
    (console.log (f))
)

;; A `return` crossing two nested `try...finally` levels must run BOTH finalizers, inner before outer
;; (D12/D47).
;;
;; Regression guard (Phase-0 finally-drop fix). Before it, the `return` jumped straight out of the
;; function, dropping both cleanups. The fix unwinds the enclosing frames inner-to-outer before the
;; return. JS always ran them in that order. Expected: "inner" THEN "outer" THEN the value 99.
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

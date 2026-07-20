;; A `return` out of a `try` must restore the handler stack, or a LATER outer `throw` longjmps into a
;; dead stack frame (D12/D47).
;;
;; Regression guard (Phase-0 finally-drop fix). Before it, `return`-inside-a-try never ran
;; `ll_handler_top = frame.prev`, so after `g` returned the global handler top dangled at `g`'s
;; destroyed frame; `main`'s later throw read that dead frame and jumped into freed memory (it CRASHED).
;; The fix restores the handler stack on return, so the outer catch handles it. Expected: 5 THEN outer
;; caught.
(
    (fn g [] -> Int (
        (try (
            (return 5)
        )
        catch e (
            (return 0)
        ))
    ))
    (try (
        (console.log (g))
        (throw (Error "after"))
    )
    catch e (
        (console.log "outer caught")
    ))
)

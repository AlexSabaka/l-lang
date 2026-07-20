;; A `return` out of a `try` must restore the handler stack, or a LATER outer `throw` longjmps into a
;; dead stack frame (D12/D47).
;;
;; RED on the C backend today: `return`-inside-a-try never runs `ll_handler_top = frame.prev`, so after
;; `g` returns, the global handler top dangles at `g`'s destroyed frame. `main` then throws AFTER the
;; call -- `ll_throw` reads the dead frame and jumps into freed memory (crash / wild jump). With the fix
;; the handler stack is restored on return, so the outer catch handles it. Expected: 5 THEN outer caught.
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

;; A mutable scalar reassigned inside a try, then read across the throw's unwind in both the `catch` and
;; the `finally` (D12/D47). Pins the -O0 clobber posture Cr-0's inline CLEANUP pad relies on: at -O0 (the
;; only C build path) the reassigned value survives the setjmp/longjmp round-trip. Expected: 5 then 5.
(
    (fn f [] -> Int (
        (mut x 0)
        (try (
            (x := 5)
            (throw (Error "boom"))
        )
        catch e (
            (return x)
        )
        finally (
            (console.log x)
        ))
    ))
    (console.log (f))
)

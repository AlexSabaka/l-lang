;; A mutable scalar reassigned inside a try, then read across the throw's unwind in both the `catch` and
;; the `finally` (D12/D47). This is the setjmp-clobber case: C11 7.13.2.1p3 makes a local of the
;; setjmp-containing function INDETERMINATE after a longjmp if it is non-volatile and was modified in
;; between -- so the C backend emits `int64_t volatile u_x` here (see codegen/c/volatiles.ts). The
;; expectation holds at EVERY optimization level; before the qualifier it silently printed 0/0 at -O1
;; and above, which is what `npm run test:c:o2` now fences. Expected: 5 then 5.
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

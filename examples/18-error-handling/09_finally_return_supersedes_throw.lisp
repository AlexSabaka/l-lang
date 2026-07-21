;; A `return` inside `finally` supersedes an in-flight throw from the try body (D12/D47) -- the throw is
;; swallowed and the finally's value returned. This is the case a lifted-function `finally` mechanism
;; could NOT express (a return there would leave only the lifted function), which is why Cr-0 keeps the
;; finally inline in the user frame. Expected: 9.
(
    (fn f [] -> Int (
        (try (
            (throw (Error "boom"))
        )
        finally (
            (return 9)
        ))
    ))
    (console.log (f))
)

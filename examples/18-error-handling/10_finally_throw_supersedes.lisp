;; A `throw` inside `finally` supersedes an in-flight throw from the try body (D12/D47) -- the first error
;; is dropped and the second propagates. Fences that a finally running on the unwind path can itself raise
;; a fresh exception that targets the enclosing handler. Expected: second.
(
    (fn f [] (
        (try (
            (throw (Error "first"))
        )
        finally (
            (throw (Error "second"))
        ))
    ))
    (try (
        (f)
    )
    catch e (
        (console.log e.message)
    ))
)

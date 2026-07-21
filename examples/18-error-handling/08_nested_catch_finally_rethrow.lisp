;; A throw crossing nested try/catch/finally runs the inner `finally` as it propagates, then the outer
;; `catch` matches, then the outer `finally` (D12/D47). Fences the Cr-0 CLEANUP-pad resume across two
;; levels: inner catch filters on the wrong type (no match) so the throw propagates through inner-finally
;; to the outer catch. Expected order: inner finally -> outer catch -> outer finally.
(
    (defclass AError :extends Error (let :ctor message))
    (defclass BError :extends Error (let :ctor message))
    (fn f [] (
        (try (
            (try (
                (throw (AError "boom"))
            )
            catch e :of BError (
                (console.log "inner catch B (should not run)")
            )
            finally (
                (console.log "inner finally")
            ))
        )
        catch e :of AError (
            (console.log "outer catch A")
        )
        finally (
            (console.log "outer finally")
        ))
    ))
    (f)
)

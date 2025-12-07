(
    (fn risky-business [] (
        (throw "Something went wrong")
    ))

    (try 
        (risky-business)
     catch error (
        (std.console.log '"Caught error: {(error)}")
     )
     finally (
        (std.console.log "Cleanup complete.")
     )
    )
    
    ;; LL0002: Fraction denominator cannot be zero
    (let bad-math 1/0)

    ;; LL0006: Constant variable must have initializer
    (let uninitialized-const)

    ;; LL0007: Try without catch/finally
    (try (std.console.log "This is illegal"))
)
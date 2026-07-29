(
    (defclass CustomError :extends Error (let :ctor message))

    (defclass SpecificError :extends Error (let :ctor message))

    (fn risky-operation [error-type] (
        (cond 
            ((== error-type "custom") (throw (CustomError "Something went wrong!")))
            ((== error-type "specific") (throw (SpecificError "Something went very wrong!")))
            ((== error-type "generic") (throw (Error "Something wrong!")))
            ((== error-type "none") (return "Success"))
        )
    ))

    (fn test-try-catch [error-type]
        (try (console.log (risky-operation error-type))
         catch err :of CustomError (console.log f"Caught custom error: {(err.message)}")
         catch err :of SpecificError (console.log f"Caught specific error: {(err.message)}")
         catch (console.log f"Caught generic error")
         finally (console.log "Cleanup operation executed."))
    )

    (console.log "Testing Try-Catch block...")

    (test-try-catch "custom")
    (test-try-catch "specific")
    (test-try-catch "generic")
    (test-try-catch "none")

)
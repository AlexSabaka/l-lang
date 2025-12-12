(
    (defclass CustomError :extends Error
        (let :ctor message))

    (fn risky-operation [should-fail] (
        (if should-fail
            (throw (new CustomError "Something went wrong!"))
            (return "Success"))
    ))

    (console.log "Starting Try-Catch block...")

    (try
        ;; Trigger the error
        (risky-operation true)
    
    (catch err :of CustomError
        (console.log '"Caught specific error: {(err.message)}"))
    
    (catch err
        (console.log "Caught generic error"))
    
    (finally
        (console.log "Cleanup operation executed.")))
)
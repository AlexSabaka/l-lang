;; Error Handling & Try/Catch
;;
;; This example demonstrates:
;; - Try/catch blocks
;; - Finally blocks
;; - Custom error handling
;; - Error propagation

(
    ;; 1. Basic try/catch
    (console.log "--- Basic Try/Catch ---")
    (try (
        (let x 10)
        (let y 0)
        ;; This might throw if division by zero is not allowed
        (let result (/ x y))
        (console.log "Result:" result)
    )
    catch err :of Error (
        (console.log "Caught error:" err)
    ))

    ;; 2. Try/catch with finally
    (console.log "--- Try/Catch/Finally ---")
    (let resource "database connection")
    (try (
        (console.log "Opening:" resource)
        ;; Simulate work
        (console.log "Working with resource")
    )
    catch err :of Error (
        (console.log "Error occurred:" err)
    )
    finally (
        (console.log "Closing:" resource)
    ))

    ;; 3. Throwing custom errors
    (console.log "--- Custom Error ---")
    ;; `-> Void`, not `-> nil`. D9 makes `nil` the bottom VALUE; the TYPE of no-value is `Void`, and
    ;; an annotation naming a type that does not exist turns checking off for the whole declaration.
    (fn validate-age [age <- Int] -> Void (
        (if (< age 0)
            (throw (Error "Age cannot be negative")))
        (if (> age 150)
            (throw (Error "Age seems unrealistic")))
        (console.log "Age is valid:" age)
    ))
    
    (try (
        (validate-age 25)
        (validate-age -5)  ;; Will throw
    )
    catch err :of Error (
        (console.log "Validation error:" err)
    ))

    ;; 4. Try/catch inside function
    (console.log "--- Function with Error Handling ---")
    (fn parse-number [str <- String] -> Int (
        (try (
            (let num (parseInt str))
            (return num)
        )
        catch err :of Error (
            (console.log "Parse failed for:" str)
            (return 0)
        ))
    ))
    
    (let val1 (parse-number "42"))
    (let val2 (parse-number "not-a-number"))
    (console.log "Parsed values:" [val1 val2])

    ;; 5. Multiple catch blocks (if supported)
    (console.log "--- Type-Specific Error Handling ---")
    (try (
        ;; Some operation that might fail
        (let data nil)
        ;; Attempt access
        (console.log data.property)
    )
    catch err :of Error (
        ;; Handle error
        (console.log "Operation failed:" err)
    ))

    ;; 6. Error in nested try/catch
    (console.log "--- Nested Error Handling ---")
    (try (
        (try (
            ;; Inner operation
            (throw (Error "Inner error"))
        )
        catch err :of Error (
            (console.log "Inner catch:" err)
            (throw (Error "Propagated error"))  ;; Re-throw
        ))
    )
    catch err :of Error (
        (console.log "Outer catch:" err)
    ))

    ;; 7. Conditional error handling
    (console.log "--- Conditional Errors ---")
    (fn safe-divide [a <- Int b <- Int] -> Int | String (
        (try (
            (if (== b 0)
                (throw (Error "Division by zero")))
            (return (/ a b))
        )
        catch err :of Error (
            (return (+ "Error: " err))
        ))
    ))
    
    (let r1 (safe-divide 10 2))
    (let r2 (safe-divide 10 0))
    (console.log "Results:" [r1 r2])

    ;; 8. Finally for cleanup (common pattern)
    (console.log "--- Resource Cleanup Pattern ---")
    (let resources [])
    (try (
        ;; Allocate resources
        (resources.push "resource1")
        (resources.push "resource2")
        (console.log "Resources allocated:" resources)
        
        ;; Do work
        (console.log "Processing...")
    )
    catch err :of Error (
        (console.log "Error during processing:" err)
    )
    finally (
        ;; Cleanup (always executes)
        (console.log "Cleaning up" resources.length "resources")
        (resources.splice 0)
    ))
)
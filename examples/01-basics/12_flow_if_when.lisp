(
    (fn check-num [n] (
        ;; Standard If/Else
        (if (> n 0)
            (std.console.log "Positive")
            (if (< n 0)
                (std.console.log "Negative")
                (std.console.log "Zero")))
    ))

    (check-num 10)
    (check-num -5)
    (check-num 0)

    ;; When Expression (Should return value)
    (fn get-status [is-online] (
        (return (when is-online :then "User is Online"))
    ))

    (std.console.log (get-status true))
    
    ;; When as a statement guard
    (let debug true)
    (when debug :then (std.console.log "Debug mode is ON"))
)
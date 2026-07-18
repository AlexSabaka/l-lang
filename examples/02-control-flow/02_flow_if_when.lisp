(
    (fn check-num [n <- Int] (
        ;; Standard If/Else
        (if (> n 0)
            (console.log "Positive")
            (if (< n 0)
                (console.log "Negative")
                (console.log "Zero")))
    ))

    (check-num 10)
    (check-num -5)
    (check-num 0)

    ;; When Expression (Should return value)
    (fn get-status [is-online <- Boolean] (
        (return (when is-online :then "User is Online"))
    ))

    (console.log (get-status true))
    
    ;; When as a statement guard
    (let debug true)
    (when debug :then (console.log "Debug mode is ON"))
)
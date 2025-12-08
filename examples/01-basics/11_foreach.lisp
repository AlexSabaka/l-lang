(
    (std.console.log "--- For-Each Loop Test ---")

    (let fruits ["Apple" "Banana" "Cherry"])

    ;; Basic iteration
    (for
        :each f
        :from fruits
        :then (std.console.log '"I like {(f)}")
        :else (std.console.log '"Last item was {(f)}")
    )

    ;; Iterating over a computed vector
    (mut total 0)
    (for :each n :from [10 20 30] :then (
        (total := (+ total n))
    ))
    (std.console.log '"Total: {(total)}")
)
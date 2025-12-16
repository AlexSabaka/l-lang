(
    (console.log "--- For-Each Loop Test ---")

    (let fruits ["Apple" "Banana" "Cherry"])

    ;; Basic iteration
    (for
        :each f
        :from fruits
        :then (console.log '"I like {(f)}")
        :else (console.log '"Last item was {(f)} (Should be Cherry)")
    )

    ;; Iterating over a computed vector
    (mut total 0)
    (for :each n :from [10 20 30] :then (
        (total := (+ total n))
    ))
    (console.log '"Total: {(total)} (Should be 60)")
)
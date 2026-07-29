(
    (console.log "--- For-Each Loop Test ---")

    (let fruits ["Apple" "Banana" "Cherry"])

    ;; Basic iteration
    (for
        :each f
        :from fruits
        :then (console.log f"I like {(f)}")
        :else (console.log f"Last item was {(f)} (Should be Cherry)")
    )

    ;; Iterating over a computed vector
    (mut total 0)
    (for :each n :from [10 20 30] :then (
        (total := (+ total n))
    ))
    (console.log f"Total: {(total)} (Should be 60)")
)
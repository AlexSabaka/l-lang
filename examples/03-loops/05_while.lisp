(
    (console.log "--- While Loop Test ---")

    (mut i 3)
    (while (> i 0) (
        (console.log f"Countdown: {(i)}")
        (i := (- i 1))
    ))

    (console.log "Liftoff!")

    ;; Nested While
    (mut row 1)
    (while (<= row 2) (
        (mut col 1)
        (while (<= col 2) (
            (console.log f"Row: {(row)}, Col: {(col)}")
            (col := (+ col 1))
        ))
        (row := (+ row 1))
    ))
)
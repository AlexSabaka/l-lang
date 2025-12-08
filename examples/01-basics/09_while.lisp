(
    (std.console.log "--- While Loop Test ---")

    (mut i 3)
    (while (> i 0) (
        (std.console.log '"Countdown: {(i)}")
        (i := (- i 1))
    ))

    (std.console.log "Liftoff!")

    ;; Nested While
    (mut row 1)
    (while (<= row 2) (
        (mut col 1)
        (while (<= col 2) (
            (std.console.log '"Row: {(row)}, Col: {(col)}")
            (col := (+ col 1))
        ))
        (row := (+ row 1))
    ))
)
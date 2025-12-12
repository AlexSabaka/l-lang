(
    (console.log "--- For Loop Test ---")

    ;; for (let i = 0; i < 5; i++)
    (for 
        :init (mut i 0)
        :cond (< i 5)
        :step (i := (+ i 1))
        :then (console.log '"Index: {(i)}")
        :else (console.log '"For loop ended at {(i)}")
    )


    (for
        :init (
            (mut j 1)
            (mut sum 0)
            (fn inc-j [] (j := (+ j 1)))
            (fn check-j [] (<= j 10))
        )
        :cond (check-j)
        :step (inc-j)
        :then (sum := (+ sum j))
        :else (console.log '"Sum 1..10 is: {(sum)}")
    )

    (for
        :init (mut i 0)
        :cond (< i 3)
        :step (i := (+ i 1))
        :then (
            (for
                :init (mut j 0)
                :cond (< j 3)
                :step (j := (+ j 1))
                :then (
                    (let linear-index (+ (* i 3) j))
                    (console.log '"i = {(i)}, j = {(j)}, Linear index: {(linear-index)}")
                )
            )
        )
    )
)
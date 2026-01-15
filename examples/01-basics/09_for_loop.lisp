;; For Loops - C-Style
;;
;; This example demonstrates:
;; - C-style for loop (:init, :cond, :step, :then)
;; - Loop variable scope
;; - Break patterns

(
    ;; 1. Basic C-style for loop
    (console.log "--- Basic For Loop ---")
    (for
        :init (mut i 0)
        :cond (< i 5)
        :step (i := (+ i 1))
        :then (console.log i))

    ;; 2. Counting backwards
    (console.log "--- Count Down ---")
    (for
        :init (mut count 10)
        :cond (>= count 0)
        :step (count := (- count 1))
        :then (console.log count))

    ;; 3. Step by larger value
    (console.log "--- Even Numbers ---")
    (for
        :init (mut num 0)
        :cond (<= num 20)
        :step (num := (+ num 2))
        :then (console.log num))

    ;; 4. Loop with accumulation
    (console.log "--- Sum 1 to 10 ---")
    (mut sum 0)
    (for
        :init (mut i 1)
        :cond (<= i 10)
        :step (i := (+ i 1))
        :then (sum := (+ sum i)))
    
    (console.log "Sum:" sum)

    ;; 5. Nested loops (times table)
    (console.log "--- 3x3 Table ---")
    (for
        :init (mut row 1)
        :cond (<= row 3)
        :step (row := (+ row 1))
        :then (
            (for
                :init (mut col 1)
                :cond (<= col 3)
                :step (col := (+ col 1))
                :then (console.log '"[{(row)},{(col)}]"))
        ))
)

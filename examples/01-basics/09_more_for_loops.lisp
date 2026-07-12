;; For Loops - C-Style
;;
;; This example demonstrates:
;; - C-style for loop (:init, :cond, :step, :then)
;; - Loop variable scope
;; - Break patterns

(
    ;; 1. Complex for loop
    (console.log "--- Complex Linear 2D For Loop ---")

    (fn :inline ij-loop-inline [max-i max-j callback] 
        (for
            :init (
                (mut i 0)
                (mut j 0)

                (fn forward [] (
                    (j := (+ j 1))
                    (if (>= j max-j) (
                        (j := 0)
                        (i := (+ i 1))
                    ))
                ))
                (fn continue [] (< i max-i))
            )
            :cond (continue)
            :step (forward)
            :then (callback i j)
    ))

    ;; (defmacro ij-loop-macro ['i 'j max-i max-j 'body] (
    ;;     (for
    ;;         :init (
    ;;             (mut `i 0)
    ;;             (mut `j 0)

    ;;             (fn forward [] (
    ;;                 (`j := (+ `j 1))
    ;;                 (if (>= `j max-j) (
    ;;                     (`j := 0)
    ;;                     (`i := (+ `i 1))
    ;;                 ))
    ;;             ))
    ;;             (fn continue [] (< `i max-i))
    ;;         )
    ;;         :cond (continue)
    ;;         :step (forward)
    ;;         :then (`body)
    ;;     )
    ;; ))


    (console.log "--- Using Macro and Inline Function ---")
    (ij-loop-macro i j 3 3 (
        (console.log '"Macro Loop - i: {(i)}, j: {(j)}")
    ))

    (console.log "--- Using Inline Function ---")
    (ij-loop-inline 3 3 (fn [i j] (
        (console.log '"Inline Loop - i: {(i)}, j: {(j)}")
    )))

    (console.log "--- Direct Implementation ---")
    (for
        :init (
            (mut i 0)
            (mut j 0)

            (fn forward [] (
                (j := (+ j 1))
                (if (>= j 3) (
                    (j := 0)
                    (i := (+ i 1))
                ))
            ))
            (fn continue [] (< i 3))
        )
        :cond (continue)
        :step (forward)
        :then (
            (console.log '"i: {(i)}, j: {(j)}")
        )
    )
)

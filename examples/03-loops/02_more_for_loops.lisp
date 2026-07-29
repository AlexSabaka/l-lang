;; For Loops - C-Style
;;
;; This example demonstrates:
;; - C-style for loop (:init, :cond, :step, :then)
;; - a `for :init` block declaring both the counters AND the functions that drive them
;;
;; The `:init` block is the point: it holds `mut` counters and two nested `fn`s that CLOSE OVER and
;; MUTATE them, with `:cond` and `:step` then being plain calls. That shape is why this file is a
;; JS-only test today -- on C the nested `fn`s declared in `:init` are not visible to `:cond`/`:step`
;; (`ELL0107 'forward'`), the same `for :init` gap parked in the roadmap alongside `03-loops/01_for`.

(
    ;; 1. Complex for loop
    (console.log "--- Complex Linear 2D For Loop ---")

    ;; `:inline` was applied here without any `(defmodifier inline ...)` anywhere -- LL0015, and
    ;; the modifier appears nowhere else in the corpus. Dropped rather than invented: an
    ;; inlining hint is a language decision, not a thing an example gets to declare in passing.
    (fn ij-loop-inline [max-i max-j callback] 
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


    ;; The `ij-loop-macro` call that stood here is gone with it: the `defmacro` it named is COMMENTED
    ;; OUT above, so the call was to a function that does not exist. The commented block stays as a
    ;; record of the intent -- macros are not a feature yet.

    (console.log "--- Using Inline Function ---")
    (ij-loop-inline 3 3 (fn [i j] (
        (console.log f"Inline Loop - i: {(i)}, j: {(j)}")
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
            (console.log f"i: {(i)}, j: {(j)}")
        )
    )
)

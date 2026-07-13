;; A retry modifier -- one that actually retries, and one that takes an ARGUMENT.
;;
;; Before D3b a modifier's arguments were parsed by both frontends and then discarded by codegen, so
;; `:retry[4]` could not have said how many times to retry even if the body had been read. Both are
;; live now: `__ll_modifier_retry(4)(originalFn)`.
;;
;; The old file declared `(defmodifier retry [])` and never retried anything -- its golden showed a
;; task simply succeeding, which is what the canned memoizer produced.

(
    ;; Retry up to `times`, until the task returns something other than nil.
    (defmodifier retry [times <- Int]
        (fn [original]
            (fn [...args]
                (mut result nil)
                (mut n 0)
                (while (&& (== result nil) (< n times))
                    (n := (+ n 1))
                    (result := (original ...args))
                    (if (== result nil)
                        (console.log "[retry] attempt" n "failed")))
                result)))

    ;; A flaky task: it fails the first two times it is called, then succeeds.
    ;;
    ;; The `return`s are explicit. An `if` as the last expression of a body is emitted as a
    ;; STATEMENT, so its value is not implicitly returned -- see the open finding on implicit
    ;; returns in DECISIONS.md. Every function in 01-basics/01_function_types.lisp writes it this
    ;; way for the same reason.
    ;; No `-> String` annotation: it returns a String OR nil, and optional types (`String?`) are
    ;; D9 -- they do not parse yet. Annotating it `-> String` is a lie the type checker correctly
    ;; rejects (LL0213).
    (mut calls 0)
    (fn flaky []
        (calls := (+ calls 1))
        (if (< calls 3)
            (return nil)
            (return "Task completed"))
    )

    (fn :retry[4] task []
        (flaky)
    )

    (console.log "Testing retry modifier:")
    (console.log "Task:" (task))
    (console.log "Attempts made:" calls)
)

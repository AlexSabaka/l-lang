;; std/test -- a program that checks itself. `test` registers a named thunk; `run-tests` runs each,
;; prints a per-test line + a summary, and exits non-zero on any failure. Assertions throw an
;; AssertionError whose message renders the values via display (D55).
(
    (import "std/test")

    (test "arithmetic" (fn [] (assert-eq 4 (+ 2 2) "sum")))
    (test "concat"     (fn [] (assert-eq "ab" (+ "a" "b") "strings")))
    (test "structural" (fn [] (assert (== [1 2 3] [1 2 3]) "vec deep-eq")))
    (test "not-equal"  (fn [] (assert-ne 1 2 "distinct")))

    ;; a failing assertion, caught directly to show the message (not through the runner, so no exit)
    (try (assert-eq 5 (+ 2 2) "bad sum")
         catch e :of AssertionError (console.log "caught:" e.message))

    (run-tests)
)

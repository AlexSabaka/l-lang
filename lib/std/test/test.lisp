;; std/test -- assertions, and self-checking programs.
;;
;; The corpus is graded by an external execute-and-assert-stdout harness; a PROGRAM has no way to check
;; itself. This module gives it one, and everything it needs already exists: `==` is D53's structural
;; deep equality, failure messages render values with `display` (D55 -- so `expected {0}, got {1}` means
;; the same string on both backends, and a Formattable type shows its own form), and `exit` comes from
;; std/sys/process. A program that ends `(run-tests)` is a portable golden of itself.
(
    (import "std/sys/process")

    ;; A failed assertion. Extends the ambient Error tower, so it is caught `:of Error` like any other
    ;; -- but naming it lets a caller catch assertion failures specifically.
    (defclass AssertionError :extends Error
        (let :ctor message <- String))

    ;; The registry: module-level, accumulated by `test`, drained by `run-tests`. A registered test is a
    ;; [name, thunk] pair; the thunk runs later, so a program registers all its tests then runs them once.
    (mut registered [])

    ;; -- assertions ----------------------------------------------------------------------------------
    ;; Each throws an AssertionError on failure, carrying a message that renders the offending values via
    ;; display. Inside a `test`, `run-tests` catches it and counts a failure; outside, it propagates.
    (fn assert [condition <- Boolean msg <- String] -> Void
        (if (! condition) (throw (AssertionError f"assertion failed: {msg}"))))

    (fn assert-eq [expected <- Any actual <- Any msg <- String] -> Void
        (if (! (== expected actual))
            (throw (AssertionError f"{msg}: expected {expected}, got {actual}"))))

    (fn assert-ne [a <- Any b <- Any msg <- String] -> Void
        (if (== a b)
            (throw (AssertionError f"{msg}: expected {a} != {b}"))))

    ;; -- the registrar + runner ----------------------------------------------------------------------
    ;; `test` registers a named zero-arg thunk; `run-tests` runs each, prints a per-test line and a
    ;; summary, and exits non-zero if any failed (so the process's exit code is the pass/fail bit). A
    ;; thunk that throws ANYTHING -- an AssertionError or a real defect -- counts as a failed test.
    (fn test [name <- String body] -> Void
        (registered.push [name body]))

    (fn run-tests [] -> Void (
        (mut passed 0)
        (mut failed 0)
        (for :each t :from registered :then (
            (let name t[0])
            (try (
                    (call t[1])
                    (passed := (+ passed 1))
                    (console.log f"ok   {name}"))
                catch e :of Error (
                    (failed := (+ failed 1))
                    (console.log f"FAIL {name}: {e.message}")))))
        (console.log f"{passed} passed, {failed} failed")
        (if (> failed 0) (exit 1))))

    (export AssertionError assert assert-eq assert-ne test run-tests)
)

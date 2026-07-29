;; std/debug -- a developer's debug toolkit, distinct from std/test's framework.
;;
;; Ad-hoc debugging rather than testing: `dbg` prints a value to STDERR and hands it back so it drops
;; inline into an expression (Rust's `dbg!`), `inspect` tags a value with its type, and the panic family
;; ends the process for the "this cannot happen" paths. Everything prints to stderr or returns a
;; value, so it never disturbs a program's stdout -- a `dbg` left in by accident does not corrupt output.
;;
;; -----------------------------------------------------------------------------------------------
;; THE PANIC FAMILY ENDS THE PROCESS. IT DOES NOT THROW. (D85's line, extended here.)
;;
;; These used to `throw (FatalError ...)`, which is catchable -- and `catch :of Error` catches it,
;; because FatalError extends Error like everything else in the D62 tower. So `(unreachable "...")`
;; inside any broad handler was SWALLOWED, and "this cannot happen" became "this was counted as a
;; recoverable failure and execution continued". That is the opposite of what the word means.
;;
;; The rule, the same one D85 draws for a zero divisor: a CONTRACT the author declared is not data to
;; recover from. `unreachable`, `todo`, `unimplemented` and `assert` are all assertions ABOUT THE
;; PROGRAM, so they end it.
;;
;; AND THIS IS WHY `std/test`'s `assert` IS DIFFERENT, rather than inconsistent. Its whole job is to
;; be caught: `run-tests` catches `:of Error`, counts a failure, and runs the next test. An assertion
;; that panicked would abort the run on the first failure and report nothing. A test assertion is a
;; MEASUREMENT the framework collects; a debug assertion is a claim the program makes about itself.
;; Two different things that happen to share a name.
;; -----------------------------------------------------------------------------------------------
(
    (import "std/llang/reflect")
    (import "std/sys/process")

    ;; Print a value to STDERR and RETURN it -- so `(f (dbg x))` logs x and still passes it to f.
    (fn dbg [x <- Any] -> Any (
        (write-string-err f"[dbg] {x}\n")
        (return x)))

    ;; The labeled twin: `[dbg] label = <value>`. (No arg defaults yet, so it is its own function.)
    (fn dbg-at [label <- String x <- Any] -> Any (
        (write-string-err f"[dbg] {label} = {x}\n")
        (return x)))

    ;; A value's type name + its display form, as a String (returned, not printed): `Int: 42`.
    (fn inspect [x <- Any] -> String
        (return f"{(name-of x)}: {x}"))

    ;; Print inspect(x) to stderr and return x.
    (fn dump [x <- Any] -> Any (
        (write-string-err f"{(inspect x)}\n")
        (return x)))

    ;; -- dev panics: END THE PROCESS ---------------------------------------------------------------
    ;;
    ;; Written in l-lang rather than as a floor entry, and that is the point: stderr + a non-zero exit
    ;; is already expressible, and nothing can catch a process that has exited. No new runtime surface,
    ;; and both backends behave identically because both already have `write-string-err` and `exit`.

    (fn panic [msg <- String] -> Void (
        (write-string-err f"panic: {msg}\n")
        (exit 1)))

    ;; The condition is the CLAIM; the message says what was being claimed. False means the program is
    ;; wrong about itself, so there is nothing to hand back to a caller.
    (fn assert [condition <- Boolean msg <- String] -> Void
        (if (! condition) (panic f"assertion failed: {msg}")))

    (fn unreachable [msg <- String] -> Void
        (panic f"unreachable: {msg}"))

    (fn todo [] -> Void
        (panic "not yet implemented (todo)"))

    (fn unimplemented [msg <- String] -> Void
        (panic f"unimplemented: {msg}"))

    (export dbg dbg-at inspect dump panic assert unreachable todo unimplemented)
)

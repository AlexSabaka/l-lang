;; std/debug -- a developer's debug toolkit, distinct from std/test's framework.
;;
;; Ad-hoc debugging rather than testing: `dbg` prints a value to STDERR and hands it back so it drops
;; inline into an expression (Rust's `dbg!`), `inspect` tags a value with its type, and the panic trio
;; throws a `FatalError` for the "this cannot happen" paths. Everything prints to stderr or returns a
;; value, so it never disturbs a program's stdout -- a `dbg` left in by accident does not corrupt output.
(
    (import "std/llang/reflect")

    ;; Print a value to STDERR and RETURN it -- so `(f (dbg x))` logs x and still passes it to f.
    (fn dbg [x <- Any] -> Any (
        (write-string-err '"[dbg] {x}\n")
        (return x)))

    ;; The labeled twin: `[dbg] label = <value>`. (No arg defaults yet, so it is its own function.)
    (fn dbg-at [label <- String x <- Any] -> Any (
        (write-string-err '"[dbg] {label} = {x}\n")
        (return x)))

    ;; A value's type name + its display form, as a String (returned, not printed): `Int: 42`.
    (fn inspect [x <- Any] -> String
        (return '"{(name-of x)}: {x}"))

    ;; Print inspect(x) to stderr and return x.
    (fn dump [x <- Any] -> Any (
        (write-string-err '"{(inspect x)}\n")
        (return x)))

    ;; -- dev panics: throw FatalError (the ambient tower) with a standard message ---------------------
    ;; A defect in the program, not a recoverable condition -- so a FatalError, distinct from a
    ;; std/test AssertionError and from the ValueError/IOError families a program is meant to handle.
    (fn unreachable [msg <- String] -> Void
        (throw (FatalError '"unreachable: {msg}")))

    (fn todo [] -> Void
        (throw (FatalError "not yet implemented (todo)")))

    (fn unimplemented [msg <- String] -> Void
        (throw (FatalError '"unimplemented: {msg}")))

    (export dbg dbg-at inspect dump unreachable todo unimplemented)
)

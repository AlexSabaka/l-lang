;; Support module for 20_imported_error_catch: a typed error that lives in ANOTHER file, the shape a
;; real stdlib (std/core/errors) has. Definitions only -- no output when run standalone.
(
    (defclass ValueError :extends Error (let :ctor message <- String))
    (fn parse-or-throw [s <- String] -> Int (
        (if (== s "42") (return 42))
        (throw (new ValueError '"bad: {(s)}"))
    ))
    (export ValueError parse-or-throw)
)

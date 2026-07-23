;; std/core/errors -- the TYPED ERROR hierarchy (the errors foundation, boilerplate tier).
;;
;; Until now the whole stdlib threw a bare `(Error "message")`, so a program could only ever
;; `catch :of Error` and could not tell a parse failure from a disk failure from a division by zero.
;; This module gives those failures NAMES, arranged in a tree so a handler can be as broad or as
;; narrow as it likes: `catch :of ValueError` takes a `KeyError` too, `catch :of Error` still takes
;; everything.
;;
;; THREE RULINGS ARE BAKED INTO THE SHAPE HERE (D62), each one measured, not chosen for taste:
;;
;;   * EVERY CLASS EXTENDS THE AMBIENT `Error`, and this module does NOT redefine `Error` itself.
;;     `Error` is preluded (`std/js`, and a builtin class on C), so redefining it reopens the extern
;;     collision and forces a migration of every corpus file that writes `:extends Error`. That is the
;;     full foundation; this is the boilerplate that sits ON the ambient root and is shippable today.
;;     `catch :of Error` matches every type below because the runtime type test walks the `:extends`
;;     chain to the host `Error` (verified on both backends).
;;
;;   * CTOR FIELDS ONLY -- no plain-default fields. The C field-layout trap (gap ledger 9.2) fires the
;;     moment an inherited PLAIN-DEFAULT field meets a deeper local ctor field: C then traps with
;;     `TypeError: expected a String`. A hierarchy built entirely from `(let :ctor ...)` fields never
;;     has ingredient one, so it dodges 9.2 by construction. Measured: `KeyError(message, key)` works
;;     on both backends; the same shape with a `(mut retriable <- Boolean false)` traps on C.
;;
;;   * NO `cause` FIELD YET. The ruled `Error(message, cause)` wants `cause` on the root, and the root
;;     is the one class this module will not touch. Adding `cause` to a mid-level class instead would
;;     be a plain/optional field on a node that HAS subclasses -- straight back into 9.2. Deferred with
;;     the rest of the full foundation (root ownership, `cause`, un-externing TypeError).
;;
;; `TypeError` and `RangeError` are left as the ambient `:extern`s they already are -- redefining them
;; collides the same way `Error` would. A program still catches them by name; they are simply not
;; re-declared here.
;;
;; The subtype/catch behaviour this module promises is pinned by
;; `examples/18-error-handling/22_typed_errors.lisp` on both backends.
(
    ;; -- the ROOT (F1) ---------------------------------------------------------------------------
    ;; `Error` is now an l-lang class, not a host `:extern`. Every error carries a `message`; the tower
    ;; below extends it, and `catch :of Error` matches all of them by walking the `:extends` chain.
    ;; Ctor field only (no `cause` yet -- that needs the C field-layout trap fixed, gap ledger 9.2).
    ;; `TypeError` / `RangeError` were host externs too, and are never caught as host traps, so they
    ;; become ordinary l-lang classes here. This module is a second AMBIENT prelude, so these resolve
    ;; everywhere with no import -- the same way the extern used to.
    (defclass Error
        (let :ctor message <- String))
    (defclass TypeError :extends Error
        (let :ctor message <- String))
    (defclass RangeError :extends Error
        (let :ctor message <- String))

    ;; -- value / lookup errors -------------------------------------------------------------------
    ;; A value was the wrong shape or out of range -- the largest family, and the one `parse-int`,
    ;; string formatting, and the container accessors all land in.
    (defclass ValueError :extends Error
        (let :ctor message <- String))

    ;; A key/index that is not present. Structured: it carries the offending key/index alongside the
    ;; message, so a handler can report or recover without re-parsing the string.
    (defclass KeyError :extends ValueError
        (let :ctor key <- String))
    (defclass IndexError :extends ValueError
        (let :ctor index <- Int))

    ;; -- arithmetic ------------------------------------------------------------------------------
    ;; Division by zero, a zero denominator, a domain error -- anything the number tower refuses.
    (defclass ArithmeticError :extends Error
        (let :ctor message <- String))

    ;; -- I/O -------------------------------------------------------------------------------------
    ;; A stream or file operation failed. `FileError` and `NotFound` carry the path.
    (defclass IOError :extends Error
        (let :ctor message <- String))
    (defclass FileError :extends IOError
        (let :ctor path <- String))
    (defclass NotFound :extends IOError
        (let :ctor path <- String))

    ;; -- fatal -----------------------------------------------------------------------------------
    ;; An unrecoverable defect: the program's invariants are broken and there is no sane way to
    ;; continue. Distinct from the recoverable families above so a top-level handler can treat it
    ;; differently.
    (defclass FatalError :extends Error
        (let :ctor message <- String))

    (export Error TypeError RangeError
            ValueError KeyError IndexError ArithmeticError IOError FileError NotFound FatalError)
)

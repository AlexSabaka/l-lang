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
;;   * `cause` IS A PLAIN FIELD, NOT A CTOR ARG. The originally-ruled `Error(message, cause)` is not
;;     viable: `cause` as a ctor param lands mid-list in every subclass's flattened ctor params
;;     (`KeyError` -> [message, cause, key]), so `(KeyError "m" "k")` mis-binds `"k"` to `cause` and
;;     fails ELL0203. So `cause` is `(mut cause <- Error? nil)` on the root, set at the throw site by
;;     the `caused-by` helper. This is exactly the inherited-plain-field-over-a-deeper-ctor-field shape
;;     that used to trap on C (gap ledger 9.2) -- now FIXED, so the tower's structured subclasses
;;     (`KeyError`/`IndexError`/`FileError`/`NotFound`) still construct with their own args unaffected.
;;
;; `Error`, `TypeError` and `RangeError` are l-lang classes (F1). On C the message-only runtime builtin
;; that used to shadow `Error` is retired -- C now emits this module's `Error` descriptor (with `cause`);
;; the layout-independent runtime (message-by-name, catch-by-name up the :extends chain) is unchanged.
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
        (let :ctor message <- String)
        (mut cause <- Error? nil))                  ;; the chained cause, or nil -- set via `caused-by`
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

    ;; -- error chaining --------------------------------------------------------------------------
    ;; Attach an underlying `cause` to an error and return it, so a throw site chains in one expression.
    ;; An `:extension` so it reads both as a free call and as a method on its receiver (D34):
    ;;   (throw (caused-by (ValueError "parse failed") original))       ;; free
    ;;   (throw ((ValueError "parse failed").caused-by original))       ;; method chain
    ;; `cause` is a PLAIN field (not a ctor arg): a ctor `cause` would land mid-list in every subclass
    ;; that adds its own field (`KeyError` -> [message, cause, key]) and mis-bind `(KeyError "m" "k")`.
    ;; A class is a reference type (D11 shares, does not copy), so mutating `e.cause` and returning `e`
    ;; hands back the same error, now carrying its cause.
    (fn :extension caused-by [e <- Error c <- Error] -> Error (
        (e.cause := c)
        e))

    (export Error TypeError RangeError
            ValueError KeyError IndexError ArithmeticError IOError FileError NotFound FatalError
            caused-by)
)

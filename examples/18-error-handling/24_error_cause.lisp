;; FEATURE: `Error` carries a `cause` field, set at the throw site by `caused-by` (std/core/errors).
;;
;; `cause` is a PLAIN field `(mut cause <- Error? nil)`, not a ctor arg -- a ctor `cause` would land
;; mid-list in every subclass's flattened ctor params (`KeyError` -> [message, cause, key]) and mis-bind
;; `(KeyError "m" "k")`. So this doubles as a guard that the C field-layout fix (gap ledger §9.2) holds
;; for the REAL tower: `KeyError` inherits the plain `cause` field from `Error` (through `ValueError`)
;; AND declares its own ctor field `key` -- exactly the inherited-plain-over-deeper-ctor shape that used
;; to trap on C. On C, `Error` is now the l-lang class (the message-only runtime builtin is retired), so
;; the `cause` field exists on both backends.
(
    ;; a freshly constructed error has no cause
    (let e1 (ValueError "bad input"))
    (console.log "1" e1.message (== e1.cause nil))

    ;; `caused-by` attaches an inner error and returns the outer -- one-expression chaining
    (let inner (KeyError "not found" "user-42"))
    (let e2 (caused-by (ValueError "lookup failed") inner))
    (console.log "2" e2.message (== e2.cause nil) e2.cause.message e2.cause.key)

    ;; the structured subclass still constructs with its OWN args (message + key); cause defaults nil
    (let k (KeyError "missing" "the-key"))
    (console.log "3" k.message k.key (== k.cause nil))

    ;; caught through the tower (IndexError :extends ValueError); read the cause off the caught error
    (try (throw (caused-by (IndexError "out of range" 7) (ArithmeticError "div by zero")))
         catch err :of ValueError
           (console.log "4" err.message err.index err.cause.message))
)

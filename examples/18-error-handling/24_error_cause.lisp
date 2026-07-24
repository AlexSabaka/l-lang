;; FEATURE: `Error` carries a `cause` field, set at the throw site by `caused-by` (std/core/errors).
;;
;; `caused-by` is an `:extension`, so ONE definition serves two surfaces (D34): a free call
;; `(caused-by e c)` AND a method chain `(e.caused-by c)`. `cause` itself is a PLAIN field
;; `(mut cause <- Error? nil)`, not a ctor arg -- a ctor `cause` would land mid-list in every subclass's
;; flattened ctor params (`KeyError` -> [message, cause, key]) and mis-bind `(KeyError "m" "k")`. So this
;; also guards the C field-layout fix (gap ledger §9.2) on the REAL tower: `KeyError` inherits the plain
;; `cause` from `Error` (through `ValueError`) AND declares its own ctor `key`. On C, `Error` is the
;; l-lang class (the message-only builtin is retired), and the `:extension` method-chain resolves through
;; the `:extends` chain (a base-class extension dispatched for a subclass receiver).
(
    ;; a freshly constructed error has no cause
    (let e1 (ValueError "bad input"))
    (console.log "1" e1.message (== e1.cause nil))

    ;; FREE form: `caused-by` as a plain function
    (let inner (KeyError "not found" "user-42"))
    (let e2 (caused-by (ValueError "lookup failed") inner))
    (console.log "2" e2.message (== e2.cause nil) e2.cause.message e2.cause.key)

    ;; METHOD-CHAIN form: the same `:extension` as a method on a bound receiver
    (let e3 (ValueError "outer"))
    (let chained (e3.caused-by (ArithmeticError "inner cause")))
    (console.log "3" chained.cause.message)

    ;; the structured subclass still constructs with its OWN args (message + key); cause defaults nil
    (let k (KeyError "missing" "the-key"))
    (console.log "4" k.message k.key (== k.cause nil))

    ;; caught through the tower; method-chain at the throw site on a COMPUTED receiver, cause read off
    (try (throw ((IndexError "out of range" 7).caused-by (ArithmeticError "div by zero")))
         catch err :of ValueError
           (console.log "5" err.message err.index err.cause.message))
)

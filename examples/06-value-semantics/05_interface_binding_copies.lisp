;; A struct held in an INTERFACE-typed binding is STILL a value: aliasing it must copy (D11).
;;
;; This is the seam where the two backends decided the copy independently and DIVERGED (spec A5):
;;   - JS read the binding's declared type (an interface) and elided the copy  -> WRONGLY aliased.
;;   - C  read the concrete `obj` ctype and copied                            -> correct.
;; The copy DECISION now rides the HIR node (HCopyStore), so both backends make the same call.
;;
;; `orig` and `alias` are independent Counters. `alias.bump` must NOT touch `orig`.
(
    (definterface ICounter
        (fn bump [] -> Int)
    )
    (defstruct Counter :implements ICounter
        (mut :ctor n <- Int 0)
        (fn bump [] -> Int (
            (this.n := (+ this.n 1))
            (return this.n)
        ))
    )
    (mut orig <- ICounter (Counter 10))
    (mut alias orig)             ;; a COPY -- a struct is a value even behind an interface
    (mut r (alias.bump))         ;; bumps alias only: 10 -> 11
    (console.log r (orig.bump))  ;; orig is untouched, so orig.bump is also 10 -> 11
)

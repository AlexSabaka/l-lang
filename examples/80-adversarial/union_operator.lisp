;; ADVERSARIAL (gap ledger §20): an `:operator` overload whose operand is a UNION type. The emitted
;; method boxes the union param (`ll_value`), so the call site must BOX the argument to match -- which
;; the C backend failed to do (it declared the param as the concrete operand ctype and passed it
;; unboxed, a `cc` error). JS was always fine. Both arms of the union are exercised: a struct operand
;; (already boxed) and an Int operand (boxed at the call site).
(
    (deftype Addable <- Box | Int)

    (defstruct Box
        (let :ctor v <- Int)
        (fn :operator + [other <- Addable] -> Box (
            (match other {
                b :of Box => (return (Box (+ this.v b.v)))
                n :of Int => (return (Box (+ this.v n)))
                _ => (return this) })))
        (fn show [] -> Int (return this.v)))

    (console.log "box+box:" ((+ (Box 3) (Box 4)).show))
    (console.log "box+int:" ((+ (Box 10) 5).show))
    (console.log "chain:" ((+ (+ (Box 1) 2) (Box 3)).show))
)

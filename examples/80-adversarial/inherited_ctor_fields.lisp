;; ADVERSARIAL (parity guard -- C-correct, JS-divergent before the fix): a `:ctor` field inherited
;; through TWO OR MORE `:extends` levels arrived nil on the JS backend.
;;
;; The JS constructor emit forwarded to `super(...)` whatever the DIRECT parent declared in its own
;; body -- correct only until a field is inherited through an intermediate class that adds no ctor
;; field of its own. `C :extends B :extends A` with the field on `A`: `B` declares nothing, so `C`
;; forwarded nothing (`constructor() { super(); }`) and the field came out nil. One level was always
;; fine, because the direct parent DID declare it.
;;
;; Hidden because every corpus hierarchy was one level deep -- almost all `:extends Error`, where
;; `Error` was a host global that accepted the argument regardless of what l-lang forwarded. The error
;; tower (`Error -> ValueError -> KeyError`) is the first structure to go two deep. The C backend
;; flattens the whole `:extends` chain and was correct at every depth; this is JS catching up
;; (`inheritedCtorParamsOf`).
;;
;; Deliberately kept to inherited-and-local CTOR fields, no plain default field on an ancestor: that
;; combination trips a SEPARATE, still-open C field-layout bug (see `js-status.ts` / the ledger), and
;; a guard that mixed the two would not isolate the fix it is here to pin.
(
    (defclass A
        (mut :ctor tag <- String)
        (mut :ctor code <- Int))               ;; TWO inherited ctor fields, to pin their order

    (defclass B :extends A)                    ;; the intermediate that adds nothing -- the trigger

    (defclass C :extends B
        (mut :ctor extra <- Int))              ;; a local ctor field BELOW the inherited ones

    (defclass D :extends C)                    ;; three levels above A, still adds nothing

    (let a (A "a" 1))
    (let b (B "b" 2))
    (let c (C "c" 3 30))
    (let d (D "d" 4 40))

    (console.log "a:" a.tag a.code)
    (console.log "b:" b.tag b.code)              ;; one level -- was already correct
    (console.log "c:" c.tag c.code c.extra)      ;; two levels + a local ctor field
    (console.log "d:" d.tag d.code d.extra))     ;; three levels

;; ADVERSARIAL (C field-layout trap -- gap ledger §9.2, the complement of inherited_ctor_fields.lisp):
;; a PLAIN default field on an ancestor, interleaved among CTOR fields across >=2 `:extends` levels,
;; made C's construction fill the wrong slots.
;;
;; C construction filled field slots by RAW INDEX (`argVals[i] -> fields[i]`), assuming positional
;; construction args line up 1:1 with the field-slot list. They only agree when no plain (non-ctor)
;; field sits at a slot BELOW a ctor field. Inheritance interleaves them: `A` declares a ctor field and
;; then a plain default field, and `C` (two levels down) adds a LOCAL ctor field -- so the flattened
;; ctor params `[tag, extra]` and the field slots `[tag, seen, extra]` disagree. `extra`'s arg landed in
;; the plain `seen` slot while `extra` itself fell to nil -> `ll_unbox_int(nil)` trapped on C
;; (`TypeError: expected an Int`).
;;
;; JS was always correct here: its constructor assigns each ctor param to its NAMED field and plain
;; fields get their own initializer. This is the C backend catching up (`buildConstruct` now fills
;; ctor-field slots in ctor order, plain fields from their defaults).
(
    (defclass A
        (mut :ctor tag <- String)          ;; a CTOR field...
        (mut seen <- Int 0))               ;; ...then a PLAIN default field, at a lower slot than `extra`

    (defclass B :extends A)                ;; empty intermediate -- the trigger

    (defclass C :extends B
        (mut :ctor extra <- Int))          ;; a LOCAL ctor field, two levels below the plain field

    (defclass D :extends C
        (mut note <- String "-"))          ;; a SECOND plain field, three levels down

    (let a (A "a"))                        ;; tag="a", seen=default 0
    (let c (C "c" 7))                      ;; tag="c", seen=default 0, extra=7
    (let d (D "d" 9))                      ;; tag="d", seen=default 0, extra=9, note=default "-"

    (console.log "a:" a.tag a.seen)
    (console.log "c:" c.tag c.seen c.extra)
    (console.log "d:" d.tag d.seen d.extra d.note)

    ;; mutate the plain field to prove it is a real, independent slot (not aliased to a ctor arg)
    (c.seen := 5)
    (console.log "c mutated:" c.seen c.extra))

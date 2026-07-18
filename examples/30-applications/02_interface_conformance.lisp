;; ============================================================
;; 02_interface_conformance.lisp -- an interface and its things.
;; ============================================================
;; Extracted from the `dungeon` game (dungeon/entity.lisp).
;;
;; `Entity` is an interface whose body is a set of member SIGNATURES (a
;; method carrying an actual body inside an interface would be LL0012).
;; A class satisfies it by declaring `:implements` -- and the claim is
;; verified (LL0209 fires if a required member is missing).
;;
;; The split this demonstrates: `Chest` has every member Entity asks for
;; but does NOT declare `:implements`. It is still accepted anywhere an
;; `Entity` is wanted (STRUCTURAL conformance) -- but an `:extension` over
;; Entity dispatches NOMINALLY, so it resolves on Monster/Item and would
;; NOT dispatch on a Chest.
;; ============================================================
(
    (definterface Entity
        (fn glyph    [] -> String)
        (fn describe [] -> String)
        (fn blocks   [] -> Boolean))

    ;; ---- Monster: a NOMINAL Entity (declares :implements) ----
    (defclass Monster :implements Entity
        (mut :ctor name <- String "goblin")
        (mut :ctor mark <- String "g")
        (mut :ctor hp   <- Int 3)

        (fn glyph    [] -> String (return this.mark))
        (fn describe [] -> String (return '"{(this.name)} (hp {(this.hp)})"))
        (fn blocks   [] -> Boolean (return true)))

    ;; ---- Item: another NOMINAL Entity ----
    (defclass Item :implements Entity
        (mut :ctor name <- String "torch")
        (mut :ctor mark <- String "!")

        (fn glyph    [] -> String (return this.mark))
        (fn describe [] -> String (return this.name))
        (fn blocks   [] -> Boolean (return false)))

    ;; ---- Chest: a STRUCTURAL Entity (no :implements) ----
    ;; It has glyph/describe/blocks, so it is accepted anywhere an Entity is
    ;; wanted -- but it is deliberately NOT nominal.
    (defclass Chest
        (fn glyph    [] -> String (return "#"))
        (fn describe [] -> String (return "a wooden chest"))
        (fn blocks   [] -> Boolean (return true)))

    ;; Polymorphic over the interface: any Entity, nominal or structural.
    (fn describe-entity [e <- Entity] -> Void
        (console.log '"  {(e.glyph)}  {(e.describe)}  (blocks: {(e.blocks)})"))

    ;; An :extension over the interface. Dispatch is NOMINAL, so it resolves
    ;; on Monster/Item; a merely structural Chest is NOT :extension-dispatchable.
    (fn :extension passable [self <- Entity] -> String
        (if (self.blocks) (return "no") (return "yes")))

    (console.log "Nominal Entities (declared :implements):")
    (describe-entity (new Monster "goblin" "g" 3))
    (describe-entity (new Item "torch" "!"))

    (console.log "Structural Entity (no :implements, still accepted):")
    (describe-entity (new Chest))

    (console.log "Extension dispatch (nominal only):")
    (let goblin (new Monster "goblin" "g" 3))
    (let torch  (new Item "torch" "!"))
    (console.log '"  goblin passable? {(goblin.passable)}")
    (console.log '"  torch passable?  {(torch.passable)}")
    ;; (chest.passable) would NOT compile: Chest is structural, not nominal.
)

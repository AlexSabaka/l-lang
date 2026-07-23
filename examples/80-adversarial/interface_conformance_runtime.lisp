;; CONFORMANCE guard: `(x :of SomeInterface)` answers at RUN TIME, on both backends.
;;
;; It used to answer FALSE. Always, for every interface, on both backends -- even for a type whose
;; `:implements` the checker had VERIFIED (LL0209 fires when a required member is missing). So the
;; language could check a claim at compile time and then had no way to ask about it at run time.
;;
;; The cause was structural rather than a wrong test. D24 ERASES interfaces: they generate no class,
;; no prototype, no descriptor. `__ll_is_type` walks the prototype chain comparing `__ll_name`, and
;; `ll_is_type` walks the `:extends` chain comparing `cls->name` -- both of which are the INHERITANCE
;; chain, which an interface is not on. There was simply nothing to find. Gap ledger §14.1.
;;
;; So conformance is now CARRIED: the transitive closure is resolved once at lowering onto
;; `HClass.interfaces` (A-0 -- both backends need the same answer, so it is decided once) and emitted
;; as `static __ll_interfaces` on JS and `ll_class.interfaces` on C. The runtime test is a flat string
;; scan, which is the only form available to it.
;;
;; A SECOND DEFECT had to be fixed first, and it was in the GRAMMAR. `:implements A B` took exactly
;; one type ref per keyword, so every name after the first fell through into the class BODY and was
;; silently parsed as a bare expression -- the claim vanished before any pass could see it, and
;; `:implements A B :extends Base` did not even parse. `08-generics/06_multiple_interfaces.lisp` was
;; GREEN over that wrong answer, because its golden does not print the interface list. Ledger §14.2.
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1. the base case -- a single `:implements`, which is what was broken.
;;   2. MULTIPLE interfaces on one keyword, which needed the grammar fix.
;;   3. TRANSITIVITY through an interface's own super (`Cursor :implements Source`): conformance is a
;;      closure, not a list of what was written on the line.
;;   4. INHERITED conformance -- a subclass conforms to what its parent implements. The C test checks
;;      per level while walking `:extends`; the JS test per prototype.
;;   5. the NEGATIVE half. An interface the type does NOT implement is false, and so is a plain value
;;      with no class at all. A conformance test that cannot fail is not a test -- and `:of` failing
;;      OPEN would be far worse than the closed failure this fixes, because it would silently widen
;;      every `match` type-pattern and every operator overload that dispatches on it.
;;   6. the type still answers about its own CLASS identity, and its `:extends` parent. The interface
;;      arm is additional, not a replacement.
(
    (definterface Source
        (fn pull [] -> Int)
    )
    (definterface Cursor :implements Source
        (fn reset [] -> Void)
    )
    (definterface Tagged
        (fn tag [] -> String)
    )

    ;; A single interface -- the base case.
    (defstruct One :implements Source
        (fn pull [] -> Int (return 1))
    )

    ;; TWO interfaces on one keyword -- the grammar fix.
    (defclass Two :implements Source Tagged
        (fn pull [] -> Int (return 2))
        (fn tag [] -> String (return "two"))
    )

    ;; Conformance through an interface's OWN super: Cursor implements Source.
    (defclass Deep :implements Cursor
        (fn pull [] -> Int (return 3))
        (fn reset [] -> Void)
    )

    ;; INHERITED conformance: Child implements nothing itself.
    (defclass Child :extends Two
        (fn extra [] -> Int (return 4))
    )

    (let a (One))
    (let b (new Two))
    (let c (new Deep))
    (let d (new Child))

    ;; 1. a single `:implements`.
    (console.log "1" (a :of Source))

    ;; 2. both of two.
    (console.log "2" (b :of Source) (b :of Tagged))

    ;; 3. transitively, through the interface's own super.
    (console.log "3" (c :of Cursor) (c :of Source))

    ;; 4. inherited from the parent class.
    (console.log "4" (d :of Source) (d :of Tagged))

    ;; 5. THE NEGATIVE HALF -- it must still be able to say no.
    (console.log "5" (a :of Tagged) (42 :of Source) ("s" :of Source))

    ;; 6. class identity and `:extends` still answer, unchanged.
    (console.log "6" (d :of Child) (d :of Two) (a :of One))
)

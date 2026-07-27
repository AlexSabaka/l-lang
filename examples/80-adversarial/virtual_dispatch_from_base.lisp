;; ADVERSARIAL: a BASE method calling an overridden method must reach the override.
;;
;; SILENT WRONG ANSWER on C, found by `09-oop/03_dispatch_and_type_patterns` printing
;; `((2 ? 3) ? (4 ? (5 ? 6)))` where JS printed `((2 + 3) * (4 + (5 * 6)))`. `resolveObjMethod`
;; devirtualized every method call whose receiver had a statically-known class, without asking whether
;; anything BELOW that class overrides it -- so `this.symbol` inside `BinOp.show` compiled to
;; `__ll_method_BinOp_symbol(__self)` and the subclass's implementation could not be reached.
;;
;; A receiver's static class is an UPPER BOUND, not an identity. `this` inside a base method is
;; routinely a subclass instance -- that is the entire point of declaring the method on the base.
;;
;; WHY THE CORPUS MISSED IT, which is the part worth keeping. `09-oop/00_inheritance.lisp` is C-pinned
;; and exercises `:extends` field and method inheritance, but never has a base method call an
;; overridden one. And in the file that DID, the neighbouring `this.left.show` dispatched correctly --
;; because `left` is typed as the INTERFACE `Node`, which has no class to devirtualize to. So half of
;; that expression was testing virtual dispatch and the other half only looked like it was.
;;
;; This file pins the shape directly, at two levels of `:extends`, in both the `this` and the
;; base-typed-variable form.
(
    ;; -- the hierarchy -----------------------------------------------------------------------------

    (defclass Animal
        ;; The TEMPLATE METHOD: declared once on the base, calls two methods the subclasses replace.
        ;; Every call in here is virtual, and none of them is written any differently from a call that
        ;; is not -- which is why getting the decision wrong is invisible at the source level.
        (fn describe [] -> String (return (+ (+ (this.name) " says ") (this.speak))))

        (fn name [] -> String (return "animal"))
        (fn speak [] -> String (return "...")))

    (defclass Dog :extends Animal
        (fn name [] -> String (return "dog"))
        (fn speak [] -> String (return "woof")))

    ;; TWO LEVELS DOWN, and it overrides only ONE of the two -- so `describe` must reach `Puppy.speak`
    ;; and `Dog.name` in the same call. A fix that walked only one level of `:extends`, or that took
    ;; the nearest override rather than the most-derived one, passes the single-level case and fails
    ;; this one.
    (defclass Puppy :extends Dog
        (fn speak [] -> String (return "yip")))

    ;; -- the base's own behaviour is unchanged -----------------------------------------------------

    (let a (Animal))
    (console.log "animal: " (a.describe))

    ;; -- one level ---------------------------------------------------------------------------------

    (let d (Dog))
    (console.log "dog:    " (d.describe))

    ;; -- two levels, mixed inheritance -------------------------------------------------------------
    ;;
    ;; `name` comes from Dog (one level up), `speak` from Puppy (its own). Both are reached from a
    ;; method declared on Animal, which knows about neither.

    (let p (Puppy))
    (console.log "puppy:  " (p.describe))

    ;; -- a BASE-TYPED binding holding a subclass instance ------------------------------------------
    ;;
    ;; Not just `this`. The receiver here is a local whose declared type is the base, so the static
    ;; class is `Animal` and the runtime class is `Puppy`.

    (let as-animal <- Animal (Puppy))
    (console.log "as base:" (as-animal.speak) (as-animal.describe))

    ;; -- a method NOBODY overrides still devirtualizes ---------------------------------------------
    ;;
    ;; The fix must not make every call dynamic: that would be correct and would quietly cost a method
    ;; table lookup on every call in the language. This one has no override anywhere, so it stays a
    ;; direct call -- asserted here only for its answer, but the emitted C is the real check and the
    ;; gap ledger's `A3:method-devirt` count is where a regression would show.

    (defclass Rock
        (fn thud [] -> String (return "thud")))
    (let r (Rock))
    (console.log "no override:" (r.thud))

    ;; -- overriding a method that the base calls INDIRECTLY ----------------------------------------
    ;;
    ;; `greet` is not overridden by anything; it calls `describe`, which is not overridden either --
    ;; but `describe` calls `speak`, which is. The virtual call is two frames below the entry point,
    ;; so a fix that only considered directly-called methods would miss it.

    (defclass Greeter
        (fn greet [x <- Animal] -> String (return (+ "hello, " (x.describe)))))

    (let g (Greeter))
    (console.log "indirect:" (g.greet (Puppy)))
)

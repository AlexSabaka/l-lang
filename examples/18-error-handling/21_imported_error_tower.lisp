;; CONFORMANCE guard (E2): a TWO-LEVEL imported error hierarchy -- construct, throw, and catch by
;; PRECISE / BASE / ROOT type, with a sibling NOT matching. Both backends.
;;
;; This was broken on both, differently: JS emitted the inlined child as `extends ValueError` (the
;; bare parent name -- ReferenceError, so the class would not even define); C's `ensureClassRegistered`
;; never registered the imported PARENT, so the class chain was incomplete and the catch matched
;; nothing (`value has no such member`). E2 fixes both: JS inlines the extends parent, C registers the
;; :extends chain.
;;
;;   1. PRECISE: catch the thrown IndexError as IndexError, reading its structured field.
;;   2. BASE: catch it as ValueError (one level up).
;;   3. ROOT: catch it as Error (two levels up, the ambient host class).
;;   4. SIBLING isolation: a KeyError is NOT an IndexError; the ValueError arm takes it.
(
    (import "21_imported_error_tower_lib.lisp")

    (try (at [10 20] 5)
         catch e :of IndexError (console.log "1 precise" e.message e.index))

    (try (at [10 20] 7)
         catch e :of ValueError (console.log "2 base" e.message))

    (try (at [10 20] 9)
         catch e :of Error (console.log "3 root" e.message))

    (try (throw (new KeyError "no such key" "user_id"))
         catch e :of IndexError (console.log "4 WRONG-sibling-matched")
         catch e :of ValueError (console.log "4 sibling-ok" e.message))
)

;; CONFORMANCE guard: `std/seq`'s `index-of` / `includes` search by STRUCTURAL equality (D53, Fg-4).
;;
;; This is a deliberate semantic change, and the file prints it next to the old answer rather than
;; asserting it. `(includes [1 2] [[1 2] [3 4]])` was FALSE and is now TRUE: the native `.includes`
;; compares by REFERENCE for containers -- JS's SameValueZero, and C's `ll_strict_eq`, which spells
;; `case LL_VEC: return a.as.v == b.as.v` -- so a freshly written `[1 2]` could never be found in a
;; list of vectors no matter what it held. The `native:` lines below are that old answer, kept as a
;; control so the change is visible in the golden instead of only in a commit message.
;;
;; D53 rules `equals` a structural, deep FLOOR primitive with `index-of`/`includes` built on it. It
;; did not need to be added: `==` ALREADY lowers to `ll_deep_eq` / `__ll_deep_eq` -- structural, deep,
;; recursive, one implementation per backend and converged on int64 exactness by Fg-1 -- and it is
;; already reachable from source. A second name for the same runtime function is a second entry to
;; keep in step, which is the cost D50 says to pay only when something is irreducible.
;;
;; `index-of` answers `nil`, not `-1`. That is this module's own posture: `first`/`last`/`at` are
;; `T?` for exactly D9's reason, and a `-1` living in the same module would be it contradicting
;; itself. The native `.indexOf` keeps `-1`; it is host interop, not the language's answer.
;;
;; The `native:` control appears ONLY on the container lines. It is deliberately absent from the
;; primitive ones: `(nums.includes 2)` on an `Int[]` disagrees between the backends today -- see
;; `native_search_numeric.lisp`, which pins that separately -- and a control that itself diverges is
;; not a control.
(
    (import "std/seq")

    (let pairs [[1 2] [3 4]])
    (let nums [1 2 3])

    ;; A primitive needle: structural and reference equality agree, and always did.
    (console.log "prim:      " (includes 2 nums))
    (console.log "prim-idx:  " (index-of 2 nums))

    ;; A CONTAINER needle: this is the change.
    (console.log "vec:       " (includes [1 2] pairs) " native:" (pairs.includes [1 2]))
    (console.log "vec-idx:   " (index-of [3 4] pairs) " native:" (pairs.indexOf [3 4]))

    ;; Deep, not one level.
    (console.log "nested:    " (index-of [[1]] [[[1]]]))

    ;; A map needle -- `==` compares maps by key set and value, so this searches by content too.
    (console.log "map:       " (includes {:a 1} [{:a 1} {:b 2}]))

    ;; Absent is `nil`, not a sentinel index.
    (console.log "absent:    " (index-of 9 nums))
    (console.log "absent-in: " (includes 9 nums))

    ;; Routing through `==` means the search inherits Fg-1's exact-at-64-bits comparison. Searching
    ;; for 2^53 in a list holding 2^53+1 must NOT find it.
    (console.log "int64:     " (includes 9007199254740992 [9007199254740993]))

    ;; Empty haystack.
    (console.log "empty:     " (includes 1 []))
)

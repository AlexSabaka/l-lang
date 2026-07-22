;; CONFORMANCE guard: where l-lang's rulings stop and the HOST's member surface begins (D50).
;;
;; A member call on a native receiver -- `(xs.slice 0 1)`, `(s.length)` -- is an ESCAPE HATCH, not a
;; floor operation. The floor is the set of ops both backends implement to ONE specification; a native
;; member is the host's own, reached deliberately. So the line is:
;;
;;   the host decides what the OPERATION MEANS        -- shallow vs deep, UTF-16 vs codepoints
;;   l-lang decides how the VALUES CROSSING IT are REPRESENTED  -- an Int is an Int on the way in
;;
;; Both halves are load-bearing and this file measures the first. The second is
;; `native_search_numeric.lisp`: `(nums.includes 2)` answered false because the literal crossed as a
;; host Number instead of an Int, and that WAS a bug -- representation is ours, not the host's.
;;
;; ------------------------------------------------------------------------------------------------
;; WHAT IS MEASURED HERE: D11's collection rule against the host's array methods.
;;
;; D11 says a struct is a VALUE and "a collection slot is a new home, so it holds a copy" --
;; `(let saved [origin])` copies, and `06-value-semantics/02_value_semantics.lisp` pins it. A host
;; `.slice` also produces a fresh collection, and its slots do NOT hold copies: JS's slice is shallow,
;; so the new array's elements are the same struct objects. Mutating through the slice reaches back.
;;
;; That is the host's meaning of `slice` and it stands. What makes it worth pinning is that C AGREES,
;; which is not obvious: C has no host, so `ll_dyn_method`'s vec arm is OUR code imitating a surface
;; that does not exist below it, and it could just as easily have copied. The two backends landing on
;; the same answer here is the property that would break silently.
;;
;; The discriminating pair is `pop` against `slice`, and the difference is not arbitrary -- it falls
;; straight out of the copy predicate reading the type channel. `nativeMembers` types `pop` as the
;; receiver's ELEMENT type, which resolves to a struct, so `typeProvablyNotAStruct` refuses and the
;; store keeps its `__ll_copy`. It types `slice` as `Array<T>`, which IS proof, so the copy is elided
;; -- and eliding it changes nothing, because `__ll_copy` returns a non-struct unchanged. The elision
;; is a no-op by construction; the aliasing comes from the host method, not from the elision.
;;
;; Which is why this file exists at all: the copy DECISION is a function of what inference reached, so
;; any change to the checker silently churns copy sites across the corpus. That churn is noise unless
;; something pins the two answers apart.
(
    (defstruct P (mut :ctor x <- Int 0))

    ;; -- l-lang's own collection store: a slot is a new home, so it holds a copy (D11).
    (mut origin (P 1))
    (let saved [origin])
    (origin.x := 42)
    (console.log "literal: " saved[0].x origin.x)

    ;; -- `pop` returns the ELEMENT type, which is a struct, so the store keeps its copy.
    (mut ps [(P 1) (P 2)])
    (mut popped (ps.pop))
    (if (!= popped nil) (
        (popped.x := 99)
        (console.log "pop:     " ps[0].x popped.x)
    ))

    ;; -- `slice` returns Array<P>: a fresh container holding the SAME structs. The host's meaning.
    (mut qs [(P 1) (P 2)])
    (mut sub (qs.slice 0 1))
    (sub[0].x := 77)
    (console.log "slice:   " qs[0].x sub[0].x)

    ;; -- `concat` likewise.
    (mut rs [(P 5)])
    (mut both (rs.concat []))
    (both[0].x := 55)
    (console.log "concat:  " rs[0].x both[0].x)
)

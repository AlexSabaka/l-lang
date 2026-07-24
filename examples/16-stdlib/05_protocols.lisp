;; std/core/protocols -- the small universal protocols and their generic dispatchers.
;;
;; `compare` gives a total order: the `Comparable` protocol when the value implements it, otherwise the
;; natural order of a primitive. `hash-of` gives the `Hashable` protocol, otherwise a content hash over
;; the value's display string (djb2 in D51's wrapping int64 with D61's bit ops -- identical on both
;; backends by construction).
(
    (import "std/core/protocols")

    ;; A version number: Comparable by its Int, Hashable by a simple mix.
    (defclass Version :implements Comparable Hashable
        (let :ctor value <- Int)
        (fn compare-to [other <- Version] -> Int (- this.value other.value))
        (fn hash [] -> Int (* this.value 7)))

    ;; compare over PRIMITIVES (the total-order fallback, no protocol needed)
    (console.log "int:" (compare 3 5) (compare 5 5) (compare 9 5))
    (console.log "str:" (compare "a" "b") (compare "b" "b") (compare "c" "b"))

    ;; compare over a COMPARABLE user type (dispatches to compare-to)
    (let v3 (Version 3))
    (let v5 (Version 5))
    (console.log "ver:" (compare v3 v5) (compare v5 v3) (compare v3 v3))

    ;; hash-of: the protocol for a Hashable, the display-hash fallback otherwise
    (console.log "hash:" (hash-of v3) (hash-of "abc") (hash-of 42))
)

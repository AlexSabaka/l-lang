;; Comparable drives std/seq's sort (and min-by/max-by via `compare`, D63): a user type that :implements
;; Comparable is ordered by its `compare-to`, with no comparator passed; primitives keep their natural
;; order (byte-identical to the old `<`-based sort). The pairwise numeric min/max live in std/math -- seq
;; owns the key-based collection reductions, so the two shelves do not collide.
(
    (import "std/seq")
    (import "std/core/protocols")

    (defclass Ver :implements Comparable
        (let :ctor n <- Int)
        (fn compare-to [other <- Ver] -> Int (- this.n other.n)))

    ;; sort PRIMITIVES (unchanged)
    (console.log "ints:" (sort [3 1 2 5 4]))
    (console.log "strs:" (sort ["banana" "apple" "cherry"]))

    ;; sort a COMPARABLE user type by its compare-to
    (let vs [(Ver 3) (Ver 1) (Ver 2)])
    (console.log "vers:" (map (fn [v] v.n) (sort vs)))

    ;; min-by / max-by over a key -- shortest / longest word, then the extreme Ver by its n
    (let words ["ccc" "a" "bb"])
    (console.log "by:" (min-by (fn [w] (length w)) words) (max-by (fn [w] (length w)) words))
    (console.log "ver-by:" (min-by (fn [v] v.n) vs) (max-by (fn [v] v.n) vs))
)

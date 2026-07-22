;; CONFORMANCE guard: `std/seq`'s ordering contract (D53, Fg-3).
;;
;; Three separate defects meet in this file, and every one of them was invisible because `sort` and
;; `sort-by` have ZERO call sites in the corpus:
;;
;;   1. `(sort [10 9 1 2])` answered `[1 10 2 9]` on JS. `coll.sort()` with no comparator is
;;      JavaScript's SPEC behaviour -- it coerces each element to a string and compares UTF-16 code
;;      units -- so it sorted numbers alphabetically. `docs/language-reference.md:81` has documented
;;      this as numeric the whole time. The doc was right and the implementation was not.
;;   2. `sort-by` THREW on JS: "Cannot convert a BigInt value to a number". It compared with
;;      `(- (key-fn a) (key-fn b))`, and `Array.prototype.sort` demands a Number from its comparator.
;;      D51 made an Int a BigInt, so `sort-by` broke the day the numeric floor landed and nothing
;;      noticed for the same reason -- nothing calls it.
;;   3. Both TRAPPED on C ("value has no such member"): `sort` is absent from `ll_dyn_method`'s
;;      vec arm, so the native member did not exist there at all.
;;
;; The ruling: `sort` orders by the language's own `<`. That is one rule for every element type l-lang
;; can order -- numbers numerically, strings lexicographically -- rather than a numeric comparator
;; that breaks on strings or a string comparator that breaks on numbers. And `sort`/`sort-by` are
;; STABLE, which a mergesort gives for free and which `Array.prototype.sort` only promises as of
;; ES2019 (C's answer would have been whatever qsort did, i.e. not stable).
(
    (import "std/seq")

    ;; Numeric, not lexicographic. `10` sorts after `9`.
    (console.log "ints:    " (sort [10 9 1 2]))
    (console.log "strings: " (sort ["pear" "apple" "fig"]))

    ;; STABILITY. Two records share key 1 and two share key 3; within each group the INPUT order must
    ;; survive, so "a" precedes "d" and "c" precedes "b".
    (console.log "stable:  " (sort-by (fn [r] r.k) [{:k 3 :n "c"} {:k 1 :n "a"} {:k 3 :n "b"} {:k 1 :n "d"}]))

    ;; The BigInt comparator trap: these keys are Ints, and the ordering must still be numeric.
    (console.log "by-key:  " (sort-by (fn [r] r.k) [{:k 10} {:k 9} {:k 1}]))

    ;; The two base cases a recursive mergesort has to get right.
    (console.log "empty:   " (sort []))
    (console.log "single:  " (sort [42]))
)

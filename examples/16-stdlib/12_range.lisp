;; std/iter Range -- the `..` operator (D46/B-0): INCLUSIVE integer ranges, a lazy Iterable<Int>.
;; `(lo .. hi)` desugars to a Range; `.by` sets the step magnitude (sign follows direction),
;; `.exclusive` drops the top bound. Permissive spacing: `0..2` lexes the same as `0 .. 2`.
(
    (import "std/iter")

    ;; inclusive, ascending
    (console.log "asc:")
    (for :each i :from (0 .. 5) :then (console.log i))

    ;; descending -- lo > hi infers step -1 (first-class, not empty)
    (console.log "desc:")
    (for :each i :from (5 .. 1) :then (console.log i))

    ;; stepped -- 0 3 6 9 (12 overshoots the inclusive 10, so it stops)
    (console.log "by3:")
    (for :each i :from ((0 .. 10).by 3) :then (console.log i))

    ;; exclusive drops the upper bound
    (console.log "excl:")
    (for :each i :from ((0 .. 4).exclusive) :then (console.log i))

    ;; permissive spacing: no spaces around `..`
    (console.log "tight:")
    (for :each i :from (0..2) :then (console.log i))

    ;; re-iterable: a Range hands back a FRESH cursor each time, so it walks twice
    (let r (1 .. 3))
    (console.log "reuse:")
    (for :each i :from r :then (console.log i))
    (for :each i :from r :then (console.log i))
)

;; ADVERSARIAL (conformance guard): the numeric floor's ONE narrowing door (D51 amendment (b)).
;;
;; `floor`/`ceil`/`round` return Real. Only `truncate` turns a Real into an Int, and it does so toward
;; zero -- agreeing with D49d's `Int / Int` and with C's `(int64_t)` cast.
;;
;; This is a contract that used to be uncheckable. `Math` was an untyped `:extern`, so the checker
;; could not compare its view of `Math.floor` against the C runtime table's -- and the two disagreed
;; (Real there, `-> Int` in lib/std/math) for as long as both existed. The intrinsic floor (D50) makes
;; the signature single-source, so a drift is now a type error rather than a wrong answer.
;;
;; Two lines carry the ruling:
;;   `round -0.5` is `-0`, which is NOT an Int value -- the tie-break rule D51 already stated is
;;   itself the proof that `round` cannot return Int.
;;   `(/ (round (* 0.866 100)) 100)` stays REAL division. With `round -> Int` it would be Int / Int,
;;   i.e. integer division under D49d, and would print 0 instead of 0.87 -- silently.
(
    (import "std/math")

    (console.log "floor 3.7:" (floor 3.7))
    (console.log "ceil 3.2:" (ceil 3.2))
    (console.log "round 3.5:" (round 3.5))
    (console.log "round -0.5:" (round -0.5))

    (console.log "round-2dp:" (/ (round (* 0.866 100)) 100))

    ;; The narrowing door, toward zero on both signs.
    (console.log "truncate 3.7:" (truncate 3.7))
    (console.log "truncate -3.7:" (truncate -3.7))
    (console.log "truncate 42.0:" (truncate 42.0))

    ;; An Int context: `truncate` is what makes this legal, and the result must survive as an Int.
    (fn nth [xs <- Int[] i <- Int] -> Int (return xs[i]))
    (let xs [10 20 30 40])
    (console.log "indexed:" (nth xs (truncate 2.9)))
)

;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): a REAL is not a key.
;;
;; The ruling (F.5): a key is an `Int` or a `String`. A `Real` is neither, so a total accessor answers
;; nil rather than inventing an index.
;;
;;     (let v [10 20 30])
;;     (get v (Math.floor 1.7))     C: nil     JS: 20
;;
;; C is right. `ll_get`'s vector arm tests `k.tag != LL_INT` and a Real fails it. JS cannot make that
;; test: after D51 an `Int` is a BigInt only where the CHECKER typed it, so an untyped integral value
;; arrives as a plain Number and `__ll_container_get` has to accept an integral Number as an index --
;; otherwise `(get v 1)` in untyped code stops working. That is D51's documented gradual collapse
;; (`__ll_is_type`'s `case 'int'` makes exactly the same concession for exactly the same reason), and
;; `Math.floor 1.7` produces an integral Number, so it slips through the one hole the concession
;; leaves.
;;
;; THE FIX IS IN THE CHECKER, NOT EITHER RUNTIME, and it is half-built. `get`/`elem` now declare their
;; key `Int | String` on the floor, which is the correct signature and is what the C backend derives
;; from -- but the argument is not yet CHECKED, because `inferTotalAccessorType` intercepts these
;; names and returns their `T?` result before reaching the branch that calls `checkCallArguments`.
;; (Nor are any other floor calls' arguments checked for a simple name: `(codepoint-length 5)` is
;; silent too. F.1 connected the floor to the checker for RETURN types and left the argument path.)
;;
;; Once that is wired, `(get xs (Math.floor i))` becomes an ELL0203 naming the fix -- which is what
;; D51 amendment (b) intends by typing every `Math.*` except `trunc` as `-> Real`: the narrowing gets
;; written down at the site that wants it.
;;
;; EXPECTED == golden, which takes C's answer. ACTUAL under JS today: 20 and 20 on the two `-real`
;; lines.
(
    (let v [10 20 30])

    (console.log "get-real: " (get v (Math.floor 1.7)))
    (console.log "elem-real:" (elem v (Math.floor 1.7)))

    ;; The CONTROL, and the point of the ruling: write the narrowing and it works, on both backends.
    ;; `Math.trunc` is the floor's sole Real -> Int door (D51 amendment (b)).
    (console.log "trunc:    " (get v (Math.trunc 1.7)))
)

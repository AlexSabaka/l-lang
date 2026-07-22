;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): Int equality is EXACT at 64 bits.
;;
;; The equality twin of int64_exact, which pins how an Int PRINTS. Nothing pinned how one COMPARES,
;; and that is a different code path: `ll_deep_eq` and `ll_strict_eq` both widen an LL_INT to a
;; `double` before comparing --
;;
;;     double x = a.tag == LL_INT ? (double)a.as.i : a.as.d;
;;
;; -- so two int64 values that differ above 2^53 collapse onto the same double and compare EQUAL. On
;; JS, D51 made an Int a BigInt and `__ll_deep_eq`'s numeric arm compares them exactly, so the two
;; backends disagree about `==` for large integers.
;;
;; Fe made this reachable: before D51 an Int could not hold 2^53+1 on JS either, so both backends were
;; wrong together and nothing could tell. Fe fixed printing and left comparison behind -- exactly the
;; kind of half-migration a guard exists to catch.
;;
;; `index-of` / `includes` go through `ll_strict_eq`, which has the same widening, so they are pinned
;; here too.
;;
;; EXPECTED == golden. ACTUAL under C today: the first two lines print `true`, and the search finds a
;; value that is not there.
(
    (let a 9007199254740993)
    (let b 9007199254740992)

    (console.log "2^53+1 == 2^53:" (== a b))
    (console.log "differ by 1:   " (== 9223372036854775807 9223372036854775806))

    ;; The same widening, reached through a container search rather than `==`.
    (let xs [9007199254740993])
    (console.log "includes 2^53: " (xs.includes b))
    (console.log "indexOf 2^53:  " (xs.indexOf b))

    ;; `==` on two statically-typed Ints compiles to a native int64 compare and is already exact --
    ;; the widening lives in the BOXED path. `elem` returns Any, so this one goes through ll_deep_eq
    ;; rather than the typed binop, which is the other half of the same bug.
    (console.log "boxed ==:      " (== (elem xs 0) b))

    ;; A control: equal values must still compare equal.
    (console.log "same is same:  " (== a 9007199254740993))
)

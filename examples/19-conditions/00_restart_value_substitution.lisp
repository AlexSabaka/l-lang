;; D47 restart-case + DIRECT invoke-restart (no handler): the body either yields a value or transfers to a
;; named restart, whose arm value becomes the whole form's value. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47 (JS is NOT the oracle -- it refuses):
;;   (lookup 1) -> body `(if (== 1 1) 100 ...)` yields 100, no transfer            -> 100
;;   (lookup 9) -> body transfers `(invoke-restart :use-default 0)` -> arm binds v=0 -> 0
(
    (fn lookup [k] -> Int (
        (restart-case
            (if (== k 1) 100 (invoke-restart :use-default 0))
            (:use-default [v] v))
    ))
    (console.log (lookup 1))
    (console.log (lookup 9))
)

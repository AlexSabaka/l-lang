;; Spread (`...x`) on the native backend.
;;
;; It had no CIR lowering at all: `[0 ...xs]` and `(f ...xs)` were both `ELL0106 spread`, so spread
;; was one of the forms that existed only on the deprecated backend. It is also the prerequisite for
;; `defmodifier` decorators, whose body is `(fn [original ...args] (original ...args))` (D75).
;;
;; Two things make the lowering more than a formality. A vector carrying a spread cannot be laid out
;; with `ll_vec_of`, because its final LENGTH is not known until the spread parts are walked; and a
;; CALL carrying one cannot use the direct C convention at all, for the same reason — so it goes
;; through the boxed convention even when the callee is an ordinary top-level function.
(
    (let xs [1 2 3])

    ;; -- in a vector literal ------------------------------------------------------------------------

    (console.log "prefix:" [0 ...xs])
    (console.log "suffix:" [...xs 4])
    (console.log "middle:" [0 ...xs 4])
    (console.log "alone:" [...xs])
    (console.log "twice:" [...xs ...xs])

    ;; The spread is spliced, not nested: a vector element that is itself a vector stays one.
    (let nested [[1 2] [3]])
    (console.log "spliced not flattened:" [...nested])

    ;; An empty spread contributes nothing.
    (let empty <- Int[] [])
    (console.log "empty:" [0 ...empty 1])

    ;; -- in a call ----------------------------------------------------------------------------------

    (fn add3 [a <- Int b <- Int c <- Int] -> Int (+ a (+ b c)))

    ;; The argument count is not static here, so the arity CHECKER has to stand down: it used to
    ;; report "'add3' expects 3 arguments, got 1", counting the written arguments rather than the
    ;; passed ones. That was not a weak check, it was a wrong one — it rejected every correct call.
    (console.log "all spread:" (add3 ...xs))

    ;; Mixed, in both orders.
    (let tail [2 3])
    (console.log "leading fixed:" (add3 1 ...tail))

    ;; A closure callee takes the same path — this is the shape a decorator needs.
    (let f (fn [a <- Int b <- Int] -> Int (+ a b)))
    (let pair [4 5])
    (console.log "through a closure:" (f ...pair))
)

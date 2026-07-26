;; A `:comptime` fold PAST 2^53 -- the bug the in-house interpreter fixed on its way in (D73).
;;
;; `:comptime` used to be evaluated by lowering the expression to JavaScript and running it in
;; `node:vm`. The answer came back through a JS `number`, which has already rounded anything past
;; 2^53, so the fold below produced 9007199254740992 -- the `+ 1` silently gone -- while the SAME
;; call at run time and the SAME literal written directly were both exact. Identically wrong on both
;; backends, with no diagnostic anywhere.
;;
;; The three lines are the whole point: a compile-time evaluator that disagrees with the run-time one
;; is worse than none at all, because the difference only appears in the builds where the fold fires.
;; The interpreter carries an Int as a bigint end to end and mints the folded literal's exact decimal
;; text, which is the same lossless-`match` channel the C backend already reads for big literals (D71).
(
    (fn :comptime inc [n <- Int] -> Int (+ n 1))
    (fn runtime-inc [n <- Int] -> Int (+ n 1))

    ;; 2^53 + 1, three ways. They must agree.
    (console.log "literal: " 9007199254740993)
    (console.log "runtime: " (runtime-inc 9007199254740992))
    (console.log "comptime:" (inc 9007199254740992))

    ;; Near Int64's ceiling, where a double is wrong by hundreds rather than by one.
    (fn :comptime dbl [n <- Int] -> Int (* n 2))
    (console.log "big:" (dbl 2305843009213693951))

    ;; Int division stays integer division at compile time, as it is at run time (D51) -- the fold
    ;; must not quietly promote to Real and answer 3.5.
    (fn :comptime half [n <- Int] -> Int (/ n 2))
    (console.log "int div:" (half 7))

    ;; And a Real fold is still a Real: the split is carried, not collapsed in either direction.
    (fn :comptime scale [x <- Real] -> Real (* x 1.5))
    (console.log "real:" (scale 3.0))
)

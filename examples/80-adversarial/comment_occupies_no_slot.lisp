;; D83 says a comment occupies no slot. D106 makes that structural: comments leave the token stream
;; at the LEXER, so no parser rule can consume one.
;;
;; Before D106 a comment was an ordinary token, and `ifExpr` has three FIXED `OPTION` slots -- so a
;; comment ATE a slot and shifted every slot after it. The displaced form was not dropped: it fell
;; out to the enclosing list and ran UNCONDITIONALLY. `(f 1)` answered 20 where it must answer 10,
;; on BOTH backends, with no diagnostic -- shared wrongness, which a differential oracle cannot see.
;;
;; Every `if` below is written with a FALSE-taking arm on purpose. A guard written as `(if true ...)`
;; cannot tell "ran as the then-branch" from "escaped the `if` and ran unconditionally" -- the
;; previous guard on this defect was written that way and passed while the bug was live.
(
    ;; 1. Between the then-branch and the else-branch: the original defect.
    (fn between [x <- Int] -> Int (
        (mut r 0)
        (if (== x 1)
            (r := 10)
            ;; displaced the else before D106
            (r := 20))
        (return r)))

    ;; 2. Before the condition: shifts cond -> then -> else, so BOTH arms move.
    (fn before-cond [x <- Int] -> Int (
        (mut r 0)
        (if
            ;; leading comment
            (== x 1)
            (r := 10)
            (r := 20))
        (return r)))

    ;; 3. Between the condition and the then-branch.
    (fn before-then [x <- Int] -> Int (
        (mut r 0)
        (if (== x 1)
            ;; middle comment
            (r := 10)
            (r := 20))
        (return r)))

    ;; 4. Two comments in one form -- a single-slot skip would fix one and not the other.
    (fn twice [x <- Int] -> Int (
        (mut r 0)
        (if (== x 1)
            ;; first
            (r := 10)
            ;; second
            (r := 20))
        (return r)))

    ;; 5. Nested: the inner `if` must not steal the outer one's else.
    (fn nested [x <- Int] -> Int (
        (mut r 0)
        (if (> x 0)
            (if (== x 1)
                ;; inner
                (r := 1)
                (r := 2))
            ;; outer
            (r := 9))
        (return r)))

    ;; The taken arm and the untaken arm, for every shape.
    (console.log "between:" (between 1) (between 0))
    (console.log "before-cond:" (before-cond 1) (before-cond 0))
    (console.log "before-then:" (before-then 1) (before-then 0))
    (console.log "twice:" (twice 1) (twice 0))
    (console.log "nested:" (nested 1) (nested 5) (nested -1))

    ;; 6. The CONTROL -- `when` and `while` carry MANY bodies, so they were never affected. If these
    ;; ever move, the fix went too far and started eating real forms.
    (mut w 0)
    (when (== 1 1)
        ;; comment in a when body
        (w := 7))
    (console.log "when:" w)

    (mut i 0)
    (while (< i 3)
        ;; comment in a while body
        (i := (+ i 1)))
    (console.log "while:" i)
)

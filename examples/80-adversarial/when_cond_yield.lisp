;; `when` and `cond` ARE EXPRESSIONS, they YIELD, and until D112 the checker did not type either.
;;
;; This is the fourth and fifth instance of one hole, after `if`'s condition, `match`'s arms and
;; `try` (D110). Each was found only by asking the same question of a different form, so this file
;; asks it of both at once and pins the answers.
;;
;; Measured against a control -- `(let a <- String (f))` where `f -> Int` is LL0200, while the same
;; annotation over `(when true (f))` and over `(cond ...)` was SILENT.
;;
;; THE TYPES ARE NOT THE SAME SHAPE, and that is the point of the rows below:
;;   * a `when` is `T?` ALWAYS -- an untaken `when` yields nil, so the optional is unconditional.
;;   * a `cond` is `T?` ONLY when no clause always matches. `(:else b)`, `(else b)` and a literal
;;     `(true b)` are three spellings of one thing -- `AstBuilder.condCase` rewrites `:else` to a
;;     literal `true` condition, so by the time the checker sees it the keyword is GONE.
(
    (fn f [] -> Int (return 5))

    ;; -- `when` YIELDS its body's last value, or nil when untaken ----------------------------------
    (console.log "when taken:" (when true (f)))
    (console.log "when untaken:" (when false (f)))

    ;; a `when` body is a BLOCK, unlike `if`'s single node -- the value is the LAST statement's.
    (mut side 0)
    (console.log "when block:" (when true (side := 1) (+ (f) 1)))
    (console.log "block ran:" side)

    ;; -- `cond` yields the taken clause, or nil when none matches ----------------------------------
    (let n 5)
    (console.log "cond first:" (cond ((> n 1) 10) (:else 20)))
    (console.log "cond else:" (cond ((> n 100) 10) (:else 20)))
    (console.log "cond none:" (cond ((> n 100) 10)))

    ;; TWO spellings of a clause that always matches, and they are the same node by the time the
    ;; checker sees it. A bare `(else b)` is NOT a third spelling -- it is `ELL0210 'else' is not
    ;; defined`, an ordinary undefined identifier. `ResolveHirToCir` carries an `isElse` test for
    ;; exactly that shape, which therefore cannot fire; recorded in docs/roadmap.md.
    (console.log "cond :else:" (cond ((> n 100) 1) (:else 2)))
    (console.log "cond literal true:" (cond ((> n 100) 1) (true 2)))

    ;; -- COMBINATION: they nest, and inside other forms ---------------------------------------------
    (console.log "when in cond:" (cond ((> n 1) (when true (f))) (:else 0)))
    (console.log "cond in when:" (when true (cond ((> n 1) 42) (:else 0))))

    ;; and the optional composes with D9 narrowing, which is what makes the `?` worth having
    (let maybe (cond ((> n 100) 1)))
    (if (!= maybe nil)
        (console.log "narrowed:" (* maybe 2))
        (console.log "narrowed: was nil"))

    ;; -- as a CALL ARGUMENT, which is a value position by definition --------------------------------
    (fn twice [x <- Int] -> Int (return (* x 2)))
    (console.log "as an argument:" (twice (cond ((> n 1) 21) (:else 0))))
)

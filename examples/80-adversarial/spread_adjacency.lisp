;; ADVERSARIAL: `...` binds by ADJACENCY, exactly as `..` does (D93).
;;
;; The two dot-operators read as a pair and behaved as a pair only by accident. D88/N4 made `..`
;; tight -- `1..2` is a range, `1 .. 2` is three elements -- and migrated 16 corpus files onto the
;; tight spelling. `...` was left alone, and went on accepting `(add3 ... xs)` identically to
;; `(add3 ...xs)`. Two operators that look like siblings, two answers to the same whitespace question.
;;
;; This file pins the tight forms, which are the ones 80 corpus sites already use. The SPACED form is
;; now `LL0037` and is pinned in `test:diagnostics` -- it cannot live here, because a file in this
;; directory has to run.
;;
;; The rule costs the corpus nothing: measured before the change, there were ZERO spaced spreads and
;; 80 tight ones. Unlike `..`, which needed a migration, this one was free.
(
    (fn add3 [a <- Int b <- Int c <- Int] -> Int (return (+ a b c)))
    (let xs [1 2 3])

    ;; -- tight, in every position a spread is legal ------------------------------------------------

    (console.log "call:      " (add3 ...xs))
    (console.log "vector:    " [0 ...xs])
    (console.log "middle:    " [0 ...xs 9])

    ;; A spread of a call's result -- the operand is an expression, not just a name, and adjacency is
    ;; about the `...` and what FOLLOWS it, not about what kind of thing follows.
    (fn pair [] -> Int[] (return [7 8]))
    (console.log "of a call: " [0 ...(pair)])

    ;; The DESTRUCTURING side of the operator -- `(let [first ...rest] …)` -- is deliberately not
    ;; exercised here: a rest pattern in a destructuring `let` has no C lowering yet
    ;; (`ELL0106 destructuring-element:rest-pattern`), which is a pre-existing gap and nothing to do
    ;; with adjacency. `04-pattern-matching/` carries the match-arm form.

    ;; -- what is refused, pinned in `test:diagnostics` ----------------------------------------------
    ;;
    ;;   (add3 ... xs)   -- LL0037: spaced, so the `...` is a separate element and not a spread
    ;;   [0 ... xs]      -- LL0037, same rule in a vector
    ;;
    ;; The spaced form is left in the tree as a bare `...` marker rather than dropped, and reported
    ;; from `SyntaxRulesAstVisitor` -- the first stage that has a diagnostics channel. Dropping it
    ;; would silently re-read `(f a ... b)` as a two-argument call, and `..`'s own note records that a
    ;; silent re-reading is the one outcome worse than an error.
    (console.log "done")
)

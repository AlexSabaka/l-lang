;; ADVERSARIAL: an n-ary operator LEFT-FOLDS into binary ones before anything else sees it (D92).
;;
;; `(% 17 10 3)` printed **7** on the JS backend. That is `17 % 10` -- the third operand was silently
;; DISCARDED, because the runtime shim defines `%` as `(a, b) => …` while defining `+ - * /`
;; variadically. Seven operators had the binary shape and dropped everything past the second:
;; `% < > <= >= == !=`. No diagnostic, on either side.
;;
;; Meanwhile the C backend folded, and `inferOperatorType` typed neither: it branches on arity 1 and
;; arity 2 and falls through to `unknown()`, so a three-operand form was checked by NOTHING. That is
;; the hole `(+ metres seconds metres)` fell through -- see `unit_dimensions.lisp` for that half.
;;
;; ONE REWRITE FIXES ALL THREE, and it is a desugar rather than three patches: lower n-ary into binary
;; above the type checker, and every rule written for two operands applies at every arity by
;; construction. Neither backend needs to know n-ary exists.
;;
;; TWO SHAPES, because the operators mean different things. Arithmetic FOLDS -- it accumulates a
;; value. A comparison CHAINS -- it accumulates a judgement, so `(< a b c)` is `a<b && b<c`, the
;; Scheme/CL reading, and folding it would compare a Boolean to an Int.
;;
;; LEFT, NOT RIGHT, and the corpus is why. `(- 10 1 2)` is 7 under a left fold and 11 under a right
;; one; 54 corpus sites already depend on the left reading, overwhelmingly `(+ a ": " b)` string
;; building. The fold was chosen to preserve the answer that already existed, not to impose a new one.
(
    ;; -- the fold is left-associative, and subtraction is where that is observable ------------------
    ;;
    ;; `(- 4 3 2 1)` is `(((4-3)-2)-1)` = -2. A right fold would be `(4-(3-(2-1)))` = 2. A language
    ;; that got this wrong would be wrong quietly, since both are plausible numbers.

    (console.log "(- 4 3 2 1):    " (- 4 3 2 1))
    (console.log "(- 10 1 2):     " (- 10 1 2))
    (console.log "(/ 100 5 2):    " (/ 100 5 2))

    ;; -- the operator that was silently dropping operands ------------------------------------------
    ;;
    ;; 17 % 10 = 7, then 7 % 3 = 1. The old JS answer was 7: it never performed the second step.
    ;; Hand-derived, and the whole reason this file exists.

    (console.log "(% 17 10 3):    " (% 17 10 3))

    ;; -- and the shapes that must NOT move ---------------------------------------------------------

    (console.log "(+ 1 2 3 4):    " (+ 1 2 3 4))
    (console.log "(* 2 3 4):      " (* 2 3 4))
    (console.log "binary (- 4 3): " (- 4 3))
    (console.log "unary  (- 4):   " (- 4))

    ;; String building is 54 of the corpus's n-ary sites, so it is the shape most likely to break.
    (console.log "concat:         " (+ "a" "b" "c" "d"))

    ;; -- the fold is STRUCTURAL, so an operand can be any expression -------------------------------
    ;;
    ;; Nested forms fold from the inside out and the result is still binary all the way down.

    (let x 10)
    (let y 4)
    (console.log "nested:         " (- (+ x y 1) 3 2))

    ;; -- evaluation order is preserved, left to right ----------------------------------------------
    ;;
    ;; The fold rebuilds the tree; it must not reorder the operands. `(- (step) (step) (step))` with a
    ;; counter is the test that would catch a right fold or a reversed accumulation: 1 - 2 - 3 = -4,
    ;; where any other order gives a different number.

    (mut counter 0)
    (fn step [] -> Int (
        (counter := (+ counter 1))
        (return counter)))
    (console.log "order:          " (- (step) (step) (step)))
    (console.log "steps taken:    " counter)

    ;; -- comparisons CHAIN, they do not fold -------------------------------------------------------
    ;;
    ;; `(< a b c)` is `a<b && b<c` (D92) -- the Scheme/CL reading. Folding it would compare a Boolean
    ;; to an Int and the form would simply never be writable. `(< 1 3 2)` is the discriminator:
    ;; chained it is FALSE, and the old JS answer was `true` because the shim's `<` was binary and the
    ;; third operand never arrived.

    (console.log "(< 1 2 3):      " (< 1 2 3))
    (console.log "(< 1 3 2):      " (< 1 3 2))
    (console.log "(< 1 2 3 4):    " (< 1 2 3 4))
    (console.log "(> 5 3 4):      " (> 5 3 4))
    (console.log "(== 1 1 1):     " (== 1 1 1))

    ;; -- and the interior operand is read ONCE ------------------------------------------------------
    ;;
    ;; A chain names its interior operands twice (`a<b && b<c`), so an impure one would run twice --
    ;; the evaluation-order class this corpus has shipped green before. An operand that is not a name
    ;; or a literal is bound to a temporary first, and the chain reads the temporary. Two impure
    ;; interiors here; `calls` is the assertion.

    (mut calls 0)
    (fn probe [n <- Int] -> Int (
        (calls := (+ calls 1))
        (return n)))
    (console.log "chain impure:   " (< 1 (probe 3) (probe 5) 9))
    (console.log "calls made:     " calls)

    ;; -- what is deliberately NOT rewritten ---------------------------------------------------------
    ;;
    ;; A SPREAD is not an n-ary operator either -- `(+ ... xs)` is a variadic application, which the C
    ;; backend refuses by name (`ELL0106 spread`). Folding it would turn a refusal into wrong code.
    ;;
    ;; And a DIMENSION never reaches the desugarer: `(/ (* Kg Meter Meter) (* Second Second Second))`
    ;; in a `:satisfies` yields plain STRINGS (D90), which is why `dimensionOperand` is its own
    ;; grammar rule. `26_units.lisp` is the guard for that.
    (console.log "done")
)

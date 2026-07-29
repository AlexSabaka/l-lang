;; ADVERSARIAL: a matrix's cells SHARE A RING, and until now a matrix had no type at all (D89).
;;
;; TWO DEFECTS, one arm. `inferExpressionType` had a `case "vector"` and NO `case "matrix"`, so
;; `[1 2 | 3 4]` inferred **Unknown** -- and an Unknown is assignable BOTH ways, so
;; `(let s <- String [1 2 | 3 4])` compiled clean. That is exactly what D88/N2 found for `0xFF`: the
;; literal did not merely lack a type, it turned CHECKING OFF at its use site. Giving the literal a
;; type is the first reason for the arm; D88's recorded Ring rule is the second.
;;
;; AND NO DESUGAR HAD EVER REACHED A MATRIX CELL. Found building this: `MatrixNode.rows` is
;; `ASTNode[][]`, and every REWRITING visitor mapped one level -- `v.map(x => isAstNode(x) ? ... : x)`.
;; A row is an array, not a node, so it came back untouched. `1/2` inside a matrix reached both
;; backends as a raw `fraction-number` (ELL0106 on C, ELL0100 on JS) and `(and a b)` inside one was
;; `LL0210 'and' is not defined` -- the logical alias never ran either. `BaseAstTreeWalker` recursed
;; properly all along, so the READING passes saw matrix cells and the REWRITING passes did not: the two
;; halves of the compiler disagreed about whether a matrix had children. Fixed in `mapChildArray`,
;; which is why the Rational and Complex matrices below run at all.
;;
;; THE RULE IS NOT "MUST BE NUMERIC". That would exclude `Rational` and `Complex` -- exactly the types
;; D88 built -- and `Money` below, which is a ring and knows nothing about numbers. It is "closed under
;; `+` and `*`", asked by resolving the `Ring` interface (D89/R1). A vector is the general container and
;; may hold a union; a matrix exists for linear algebra, where `*` across two element types means
;; nothing.
;;
;; SHARE MEANS THE SAME TYPE, and that is a ruling with a measurement behind it. `isAssignable` was the
;; obvious choice and would have made `[1 1/2 | 2 3]` a matrix of Rational through D88's promotion --
;; except NOTHING COERCES THE CELLS. The emitted matrix still holds a raw `1`, so the element type would
;; be a claim the value does not honour. Promotion works for an OPERATOR because the backend emits the
;; `__cast_*` call at the operand; a container has no such site. So the remedy is the source -- write
;; `1/1` -- and the diagnostic says so.
;;
;; THIS FILE IMPORTS NOTHING. `std/core/protocols` is demand-injected on the `matrix` node, the same
;; ruling shape as `1/2` pulling in `std/math` (D88/N1): writing a matrix IS the request. Measured free
;; -- an injected `std/core/protocols` adds ~7 lines to a 2775-line floor.
(
    ;; -- the primitives, which needed R1's widening to conform at all ------------------------------
    ;;
    ;; Before D89 no primitive conformed to ANY interface, so `Int` was not a Ring and the commonest
    ;; matrix in existence would have failed its own rule.

    (console.log "int:  " [1 2 | 3 4])
    (console.log "real: " [1.0 2.0 | 3.0 4.0])

    ;; -- D88's types, which are the reason the rule is not "numeric" --------------------------------
    ;;
    ;; Both conform through their DECLARED `:operator +` / `:operator *`, and both needed the desugar
    ;; fix above to survive as far as a backend.

    (console.log "rat:  " [1/2 1/3 | 1/4 1/5])
    (console.log "cplx: " [1+1i 2+2i | 3+3i 4+4i])

    ;; -- a ring that is not a number ----------------------------------------------------------------
    ;;
    ;; `Money` never says `:implements Ring`; it merely HAS `+` and `*`, and structural conformance
    ;; (D42/Zg) does the rest. A matrix of these is admitted for the same reason a matrix of Int is.

    ;; No `format`, and no `:implements Formattable`, deliberately -- so it prints structurally. Adding
    ;; either would mean NAMING an interface this file never imported, and that is `LL0245`: the name
    ;; would resolve only because the matrix literal pulled `std/core/protocols` in. The literal implies
    ;; its own import; a name written by the author does not. The injection is not a back door.
    (defclass Money
        (mut :ctor cents <- Int)
        (fn :operator + [o <- Money] -> Money (return (Money (+ this.cents o.cents))))
        (fn :operator * [o <- Money] -> Money (return (Money (* this.cents o.cents)))))

    (console.log "money:" [(Money 1) (Money 2) | (Money 3) (Money 4)])

    ;; -- a matrix is a vector of vectors, and its shape is unchanged -------------------------------
    ;;
    ;; The arm gives the literal a TYPE; it does not give it a new runtime representation. Indexing
    ;; still reads a row and then a cell, exactly as `05-data-structures/03_matrices` has always shown.

    (let grid [10 20 | 30 40])
    (console.log "row 0:" (grid[0]))
    (console.log "cell:" (grid[1 1]))

    ;; -- the refusals are pinned in `test:diagnostics`, where a file may fail to compile ------------
    ;;
    ;; `[1 "x" | 2 3]` and `[1 1/2 | 2 3]` are LL0246 for mixed cells; `["a" "b" | "c" "d"]` is LL0246
    ;; for an element type that is not a Ring; and `(let s <- String [1 2 | 3 4])` -- the regression
    ;; that motivated the whole arm -- is LL0200 now instead of compiling clean.
)

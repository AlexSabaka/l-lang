;; INDEXERS: the rows that agree, pinned. The two that do not are recorded in docs/roadmap.md.
;;
;; THE IMPURE-INDEX ROWS ARE THE POINT. This project's own contract names evaluation order as a class
;; it has shipped green bugs in -- "two evaluation-order bugs once shipped green because nothing
;; exercised an impure operand before a compound one". An index expression with a side effect is
;; exactly that shape, and nothing in the corpus had one. Both the read and the store below call
;; their index function EXACTLY ONCE; a double evaluation would print 2 and is the failure a
;; naive lowering produces, because the index is needed twice (once to bounds-check, once to address).
;;
;; WHAT IS DELIBERATELY NOT PINNED HERE, both measured in docs/roadmap.md:
;;   * an OUT-OF-BOUNDS STORE is SILENTLY DROPPED on C (a read at the same index traps), and extends
;;     the vector on JS. Three possible behaviours, and C picked the only silent one.
;;   * the evaluation ORDER of an indexed store DIVERGES -- C evaluates the value then the index, JS
;;     the index then the value. C's order is a deliberate memory-safety choice and nothing rules it.
;; Pinning either would freeze an answer that is still open.
(
    (import "std/protocols")

    ;; 1. Reads: a vector, a nested vector, a string, and a map.
    (let v [10 20 30])
    (console.log "vector read:" v[1])
    (let grid [[1 2] [3 4]])
    (console.log "nested read:" grid[1][0])
    (let greeting "hello")
    (console.log "string read:" greeting[1])
    (let m {"a" 1  "b" 2})
    (console.log "map read:" m["b"])

    ;; 2. AN IMPURE INDEX, read side. Called once, and the value is the one at that index.
    (mut read-calls 0)
    (fn one [] -> Int ((read-calls := (+ read-calls 1)) (return 1)))
    (let got v[(one)])
    (console.log "impure index, read:" got read-calls)

    ;; 3. AN IMPURE INDEX, store side. Same rule on the other direction.
    (mut store-calls 0)
    (fn zero [] -> Int ((store-calls := (+ store-calls 1)) (return 0)))
    (mut w [7 8 9])
    (w[(zero)] := 99)
    (console.log "impure index, store:" w[0] store-calls)

    ;; 4. CALL-ARGUMENT ORDER is left-to-right and both backends agree -- the control that says this
    ;;    file can detect an order change at all, since the indexed-store order is where they differ.
    (mut order "")
    (fn a [] -> Int ((order := (+ order "a")) (return 1)))
    (fn b [] -> Int ((order := (+ order "b")) (return 2)))
    (fn sum2 [x <- Int  y <- Int] -> Int (return (+ x y)))
    (let total (sum2 (a) (b)))
    (console.log "call argument order:" order total)

    ;; 5. INSIDE A GENERATOR FRAME -- the vector lives in a boxed frame slot and is indexed across a
    ;;    suspension.
    (fn :gen g [] -> Iterator<Int> (
        (let items [5 6 7])
        (yield items[0])
        (yield items[2])))
    (mut gen-total 0)
    (for :each x :from (g) :then (gen-total := (+ gen-total x)))
    (console.log "indexed in a generator:" gen-total)

    ;; 6. INSIDE A CATCH ARM -- an index read after a longjmp landing.
    (mut caught 0)
    (let src [4 5 6])
    (try ((throw (new ValueError "boom"))) catch e ((caught := src[2])))
    (console.log "indexed in a catch arm:" caught)

    ;; 7. A STORE THEN A READ BACK, in bounds, so the store path is pinned as doing something.
    (mut z [1 2 3])
    (z[2] := 42)
    (console.log "in-bounds store:" z[2] z.length)
)

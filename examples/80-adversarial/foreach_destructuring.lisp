;; CONFORMANCE guard: D16's destructuring `for :each` on BOTH backends.
;;
;; `(for :each [key val] :from pairs ...)` is documented on ForEachNode ("D16: destructures") and has
;; worked on JS since it was written. The C backend REFUSED it outright -- `ELL0106 Cannot generate C
;; for 'foreach-destructuring'` -- which made three corpus files unreachable for reasons that had
;; nothing to do with what those files are about: `16-stdlib/02_linq_pipeline` (`[i e]` over
;; `enumerate`), `13-generators/00` (`[up down]` over `zip`), and `05-data-structures/02_maps`
;; (`[key val]` over map entries, an xfail for unrelated reasons).
;;
;; TWO THINGS ARE EASY TO GET WRONG HERE, and both are why this file exists rather than a one-liner.
;;
;; ARITY. `ll_index_vec` TRAPS out of range -- "RangeError: vector index out of bounds", a process
;; exit -- while JS's `let [a, b, c] = [1, 2]` simply leaves `c` undefined, which D9 makes nil. A bare
;; index would therefore turn a short element into a CRASH on C and a quiet nil on JS, in the one
;; construct whose entire appeal is that it reads like a pattern match. So the element read is
;; bounds-guarded (`i < len ? elem[i] : nil`). Lines 3 and 4 pin both directions of the mismatch.
;;
;; SCOPE. `:else` runs after the loop and may read the final binding -- `03-loops/04_foreach.lisp`
;; does exactly that with a plain variable. So the destructured names cannot be declared inside the
;; loop body, or `:else` would not compile in C; they are declared beside the element variable and
;; only ASSIGNED per iteration. That is the same shape the JS emitter reaches for, and for the same
;; reason (`let x, y; for ([x, y] of pts)`, because `let [x, y];` is not legal JavaScript). Line 5
;; is what fails if either backend gets the placement wrong.
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1. the base case, over an array of pairs -- the direct index loop (`viaProtocol: false`).
;;   2. the PROTOCOL arm: the same pattern over a hand-written `Iterable` whose elements are pairs.
;;      A different lowering entirely, and after Phase G4c this is the arm a generator arrives on.
;;   3. MORE names than the element has: the tail binds nil, it does not trap.
;;   4. FEWER names than the element has: the extra members are dropped, silently and deliberately.
;;   5. `:else` reads both bindings after the loop -- the scope-placement guard.
;;   6. KEBAB-CASE binding names, which mangle (`item-name` -> `u_item_2dname`). The same class of
;;      bug F.7/F.8 fixed for functions and fields, one construct along.
(
    (import "std/iter")

    ;; A hand-written Iterable whose elements are PAIRS -- the protocol arm's source.
    (defstruct PairFeed :implements Iterable<Any>
        (mut :ctor n <- Int 0)
        (fn iterator [] -> Iterator<Any> (return this))
        (fn next [] -> Any (
            (if (>= this.n 3) (return nil))
            (this.n := (+ this.n 1))
            (return [this.n (* this.n 10)])
        ))
    )

    ;; 1. the index-loop arm.
    (for :each [a b] :from [[1 2] [3 4]] :then (console.log f"idx {(a)},{(b)}"))

    ;; 2. the protocol arm.
    (for :each [k v] :from (PairFeed 0) :then (console.log f"proto {(k)},{(v)}"))

    ;; 3. more NAMES than members -- the tail is nil, not a trap. Tested as `(== r nil)` rather than
    ;;    by printing `r`: the two backends RENDER the bottom value differently in interpolation
    ;;    (C's ToString says "null", JS's `${undefined}` says "undefined"), which is a real divergence
    ;;    but a different one, and pinning it here would make this guard fail for the wrong reason.
    (for :each [p q r] :from [[7 8]] :then (console.log f"short {(p)},{(q)} r-nil={(== r nil)}"))

    ;; 4. more MEMBERS than names -- the extras are dropped.
    (for :each [s t] :from [[1 2 3]] :then (console.log f"long {(s)},{(t)}"))

    ;; 5. `:else` sees the final bindings, which is why they are not declared in the loop body.
    (for
        :each [m n]
        :from [[1 2] [5 6]]
        :then (console.log f"loop {(m)},{(n)}")
        :else (console.log f"after {(m)},{(n)}")
    )

    ;; 6. kebab-case names mangle on the way to C.
    (for :each [item-name item-qty] :from [["bolt" 4]] :then (
        (console.log f"kebab {(item-name)} x{(item-qty)}")))
)

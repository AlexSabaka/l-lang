;; ADVERSARIAL: a loop BOUND to a name is a LAZY SEQUENCE, and one iteration yields its body (D100).
;;
;;     (let ys (for :each x :from xs :then (* x 2)))     ys is 2 4 6, computed on demand
;;
;; This supersedes D94's `nil` FOR THE BOUND CASE ONLY. A loop in statement position is untouched and
;; still yields nil -- which is the elision that makes the whole thing affordable. Measured across
;; corpus and stdlib: **367 loops, of which 3 are in value position.** Rewriting every loop into a
;; coroutine would allocate 364 frames nobody asked for.
;;
;; IT RUNS BEFORE THE SYMBOLS STAGE, and that is not a detail. The rewrite INTRODUCES a `:gen`
;; declaration, and the symbol table is built one stage later; a first attempt put it in the desugarer
;; (which runs AFTER symbols) and failed with `LL0210 '__ll_seq_0' is not defined` -- nothing was ever
;; going to give the synthesized name a symbol. That is the same rule D95 states for `defsyntax`, and
;; the same reason `:comptime` may run late: a comptime fold only DELETES declarations, so the table it
;; was built against stays true.
;;
;; And it is only possible at all because C2 made a NESTED `:gen` lower on C -- a loop lives inside a
;; function, so its synthesized generator is nested by construction.
(
    (import "std/iter")
    (import "std/iter/linq")

    ;; -- the comprehension reading: one iteration yields its BODY's value ---------------------------

    (let xs [1 2 3])
    (let doubled (for :each x :from xs :then (* x 2)))
    (mut sum 0)
    (for :each v :from doubled :then (sum := (+ sum v)))
    (console.log "2+4+6:" sum)

    ;; -- LAZY, which is the point and is observable -------------------------------------------------
    ;;
    ;; The body has a side effect. Binding the loop runs NOTHING; the effect appears only as the
    ;; sequence is pulled. Under D94 this counter would already read 3 at the first print.

    (mut ran 0)
    (let counted (for :each x :from xs :then ((ran := (+ ran 1)) x)))
    (console.log "before pulling:" ran)
    (mut total 0)
    (for :each v :from counted :then (total := (+ total v)))
    (console.log "after pulling:" ran)

    ;; -- a `while` works the same way ---------------------------------------------------------------

    (mut i 0)
    (let ws (while (< i 3) ((i := (+ i 1)) i)))
    (mut wsum 0)
    (for :each v :from ws :then (wsum := (+ wsum v)))
    (console.log "1+2+3:" wsum)

    ;; -- a C-STYLE `for` is ROTATED into a `while` --------------------------------------------------
    ;;
    ;; `(for :init i :cond c :step s :then b)` becomes `i; (while c (b s))`. It has to be: coroutine
    ;; lowering splits the body across resume labels, and a C `for(...)` update slot holds one
    ;; expression. Without the rotation the emitter refuses outright ("for update must be an expression
    ;; or a simple assignment"). The identity is the same one the hand-written proof of this design used.

    (let cs (for :init (mut k 1) :cond (< k 4) :step (k := (+ k 1)) :then (* k 10)))
    (mut csum 0)
    (for :each v :from cs :then (csum := (+ csum v)))
    (console.log "10+20+30:" csum)

    ;; -- and being a sequence, it COMPOSES ----------------------------------------------------------
    ;;
    ;; This is what a statement `for` could never do. `to-list` forces it.

    (let evens (for :each x :from [1 2 3 4 5 6] :then x))
    (let firstTwo (evens |> (take 2) |> to-list))
    (console.log "take 2:" firstTwo)

    ;; -- what is NOT covered, and is honest about it ------------------------------------------------
    ;;
    ;; Only a loop BOUND to a name. A loop as a CALL ARGUMENT or a `return` operand is still D94's
    ;; `nil` -- `(+ (while …) 1)` is still LL0204, pinned in test:diagnostics. That line is an
    ;; increment, not a principle, and roadmap says so.
    (console.log "done")
)

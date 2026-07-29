;; ADVERSARIAL: a NESTED `:gen` lowers on C, and it captures its enclosing scope (C2, spec A8).
;;
;; A top-level `:gen` has compiled since D58. A nested or lambda one was `ELL0105` -- "the C backend
;; does not lower this coroutine form" -- so laziness existed only at module scope on the REFERENCE
;; backend while JS had it everywhere. That is the gap that made "a loop yields a sequence" impossible
;; to build: a loop lives inside a function, so its synthesized generator is nested by construction.
;;
;; WHY IT WAS HARD, AND WHAT ACTUALLY CHANGED. A generator's frame is `ll_obj.fields[]` -- a flexible
;; array of `ll_value`, uniformly boxed by construction -- while a MUTABLE capture was a bare
;; `ll_value*` heap cell, and the value union has no pointer arm (int/real/bool/char/str/vec/map/obj/
;; closure). So a captured `mut` could not be put in a frame slot at all.
;;
;; A CELL IS A ONE-FIELD OBJECT NOW. That is the whole fix, and it needed no change to the value union:
;; an object boxes into a slot like anything else. The alternative -- an 11th tag on `ll_value` -- would
;; have put a user-invisible arm through 47 `case LL_` sites, equality, copy and display, for something
;; that must never be observed.
;;
;; The rest falls out of a ruling that was already there: `promoteFrame` promotes EVERY param and local
;; to a frame slot ("promote everything", D58), so a capture is just another slot and the state machine
;; needs no special case for it.
(
    (import "std/iter")
    (import "std/iter/linq")

    ;; -- capturing a READ-ONLY binding -------------------------------------------------------------
    ;;
    ;; The generator is declared inside `take-from`, and `limit` belongs to the enclosing call. Each
    ;; call gets its own.

    (fn take-from [limit <- Int] -> Int (
        (mut total 0)
        (fn :gen upto [] -> Iterator<Int> (
            (mut i 0)
            (while (< i limit) (
                (yield i)
                (i := (+ i 1))
            ))
        ))
        (for :each v :from (upto) :then (total := (+ total v)))
        (return total)))

    (console.log "sum 0..2:" (take-from 3))
    (console.log "sum 0..4:" (take-from 5))

    ;; -- capturing a MUTABLE binding, which is the case that could not be represented ---------------
    ;;
    ;; `n` is a `mut` of the enclosing frame that the generator both READS and WRITES. If the capture
    ;; were by value the generator would advance its own copy, `n after` would be 0, and the loop would
    ;; never end -- the exact by-value failure C1 chased through three separate places.

    (fn counted [] -> Int (
        (mut n 0)
        (mut sum 0)
        (fn :gen bump [] -> Iterator<Int> (
            (while (< n 3) (
                (yield n)
                (n := (+ n 1))
            ))
        ))
        (for :each v :from (bump) :then (sum := (+ sum v)))
        (console.log "n after the loop:" n)
        (return sum)))

    (console.log "sum of yields:" (counted))

    ;; -- EACH CALL GETS ITS OWN FRAME ---------------------------------------------------------------
    ;;
    ;; Two instances of the same nested generator, pulled to exhaustion one after the other. A shared
    ;; frame would leave the second already parked and yield nothing -- which is what makes this the
    ;; per-instance test rather than a repeat of the one above.

    (fn twice-over [] -> Int (
        (mut acc 0)
        (fn :gen pair [] -> Iterator<Int> (
            (yield 1)
            (yield 2)
        ))
        (for :each a :from (pair) :then (acc := (+ acc a)))
        (for :each b :from (pair) :then (acc := (+ acc b)))
        (return acc)))

    (console.log "two instances:" (twice-over))

    ;; -- an INFINITE nested generator, consumed finitely -------------------------------------------
    ;;
    ;; Eager evaluation would not return. Pulled through the RAW CURSOR (`iter` / `next`) rather than
    ;; `|> (take 2)`, and deliberately: a nested closure in a PIPELINE HEAD is emitted as the closure
    ;; VALUE instead of being called on the C backend -- `ll_box_closure(u_f)` where the top-level
    ;; spelling emits `u_f()`. That is a pre-existing defect with nothing to do with generators (a
    ;; nested PLAIN function fails identically, and both work on JS), so it is recorded in roadmap
    ;; rather than smuggled into this file's subject.

    (fn first-two-odds [] -> Int (
        (mut got 0)
        (fn :gen odds [] -> Iterator<Int> (
            (mut k 1)
            (while true (
                (yield k)
                (k := (+ k 2))
            ))
        ))
        (let it (iter (odds)))
        (got := (+ got (next it)))
        (got := (+ got (next it)))
        (return got)))

    (console.log "1 + 3:" (first-two-odds))

    ;; -- `:async` is STILL refused, by ruling rather than by gap (D60) ------------------------------
    ;;
    ;; `refuseCoroutine` is left guarding exactly that. A nested `:gen` lowering does not make an
    ;; `:async` one lower, and the two must not drift into each other.
    (console.log "done")
)

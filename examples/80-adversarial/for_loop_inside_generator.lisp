;; A `for :init/:cond/:step` CONTAINING A YIELD -- which used to CRASH the C compiler.
;;
;; Not a diagnostic and not a wrong answer: an uncaught `Error: C emit: for update must be an
;; expression or a simple assignment` (`EmitCirToC.ts`), a Node stack trace and a non-zero exit. JS ran
;; the same program correctly. The most basic counting generator anyone would write:
;;
;;     (fn :gen g [] -> Iterator<Int> (for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (yield i)))
;;
;; Frame promotion (D58) rewrites every binding into a frame slot, so the `:step` assignment stops
;; being a store to a NAME and becomes a store to a FIELD -- and the update arm accepted only names.
;; The corpus never contained the shape, which is why 370 files and a green gate never saw it: the
;; corpus is a floor, not a census.
;;
;; ONLY `field` WAS ADMITTED, and the reason is about C. An update clause must be one expression, so
;; it cannot use the temp that the ordinary assign path interposes -- and that temp exists to stop a
;; slot address being taken before a right-hand side that may `realloc` the storage it points into,
;; which is real memory corruption this project has already paid for once. A field is `(obj)->fields[n]`,
;; a fixed slot in an object that never grows. An INDEX store in a `:step` -- `(v[0] := (+ v[0] 1))`,
;; legal l-lang with no generator anywhere near it -- still crashes, and is recorded in docs/roadmap.md
;; with the runtime helper that would close it.
(
    (import "std/protocols")

    ;; 1. the shape that crashed
    (fn :gen count [] -> Iterator<Int> (
        (for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (yield i))))

    ;; 2. NESTED loops in one frame -- two induction variables, both promoted, both stepping across
    ;;    suspensions. The inner loop's variable must not be reset by the outer loop's re-entry.
    (fn :gen pairs [] -> Iterator<Int> (
        (for :init (mut i 0) :cond (< i 2) :step (i := (+ i 1)) :then
            (for :init (mut j 0) :cond (< j 2) :step (j := (+ j 1)) :then
                (yield (+ (* i 10) j))))))

    ;; 3. COMBINED WITH D115: a protected region inside the loop body, the suspend outside it. The
    ;;    landing on i=1 must not disturb the induction variable, which lives in the frame and so is
    ;;    immune to the C11 clobber class by construction rather than by `volatile`.
    (fn :gen guarded [] -> Iterator<Int> (
        (for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (
            (mut v 0)
            (try ((v := (* i 2)) (if (== i 1) (throw (new ValueError "boom")))) catch e ((v := 99)))
            (yield v)))))

    ;; 4. `for :each` in a frame, which reaches the coroutine lowering by a DIFFERENT path -- one
    ;;    containing a suspend is rewritten into an explicit cursor loop before promotion, so this row
    ;;    guards that rewrite rather than the update arm.
    (fn :gen doubled [] -> Iterator<Int> (
        (for :each x :from [5 6 7] :then (yield (* x 2)))))

    (fn dump [tag <- String  it <- Any] -> Void (for :each x :from it :then (console.log tag x)))
    (dump "count:" (count))
    (dump "pairs:" (pairs))
    (dump "guarded:" (guarded))
    (dump "doubled:" (doubled))
)

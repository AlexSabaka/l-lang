;; CONFORMANCE guard: D58's DISPOSAL -- releasing a sequence source that is ABANDONED.
;;
;; A lazy source is routinely walked away from rather than exhausted: `take`, `take-while` and `zip`
;; all stop early, which is what they are for. So "the sequence ended" and "the consumer walked away"
;; are different events, and only the second wants a cleanup hook.
;;
;; TWO AMENDMENTS TO D58 ARE PINNED HERE, both forced by measurement rather than preference.
;;
;; (1) RECOGNITION IS DUCK-TYPED, not a type test. D58 said consumers would "dispose what is
;;     `Disposable`, leave the rest alone" -- but `(x :of SomeInterface)` answers FALSE on both
;;     backends today, even for a type that declares `:implements`, so the mechanism it named does not
;;     exist to call. `dispose` checks for a callable `dispose` member instead. It is TOTAL: a value
;;     without one is left alone, which is what lets a consumer call it unconditionally on whatever it
;;     was handed. Lines 1-2 pin the totality, because a `dispose` that trapped on an array would make
;;     every operator that calls it unusable on the corpus's most common source.
;;
;; (2) WHAT IS DISPOSED IS THE COLLECTION, not the cursor. D58 said "the source cursor they abandon",
;;     but `(iter coll)` does not return the same KIND of thing on the two backends: C's `ll_iter`
;;     asks an object for `iterator()` and gets the object back, while JS's `iter` always builds a
;;     fresh `{next(){...}}` wrapper that has no `dispose` and no identity. Disposing the cursor would
;;     therefore work on C and silently no-op on JS. The operators dispose their own `coll` parameter,
;;     which is the same object on both.
;;
;; A GENERATOR has no user cleanup to run -- LL0239 forbids a suspend inside a protected region, so
;; there is no `finally` to honour -- so its disposal is to PARK it: a later pull answers nil instead
;; of resuming into the middle of an abandoned body. Line 6 is that, and it is the one case where the
;; two backends reach the same contract by different means (C sets the frame's state to a value the
;; dispatch does not name; JS calls `function*`'s own `.return()`).
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1. `dispose` is TOTAL over every shape that has no `dispose` member.
;;   2. ...and CALLS it on a type that has one.
;;   3. `take` releases the source it abandons -- the case D58 calls "where the real leak lives".
;;   4. `take-while` likewise, abandoning at the first element that fails the predicate.
;;   5. `zip` releases BOTH sides: when either runs out the other is abandoned mid-sequence.
;;   6. a GENERATOR is parked, not cleaned up -- pulling it again answers nil rather than resuming.
;;   7. THE NEGATIVE HALF: a source with NO `dispose` through the same operators must not trap. This
;;      is the whole corpus's shape, so if totality were wrong every lazy chain would die here.
(
    (import "std/iter")
    (import "std/iter/linq")

    (defstruct Res :implements Iterable<Int>
        (mut :ctor n <- Int 0)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (>= this.n 9) (return nil))
            (this.n := (+ this.n 1))
            (return this.n)))
        (fn dispose [] -> Void (console.log "  [Res disposed]"))
    )

    (defstruct Letters :implements Iterable<Any>
        (mut :ctor i <- Int 0)
        (fn iterator [] -> Iterator<Any> (return this))
        (fn next [] -> Any (
            (if (>= this.i 2) (return nil))
            (this.i := (+ this.i 1))
            (return this.i)))
        (fn dispose [] -> Void (console.log "  [Letters disposed]"))
    )

    ;; 1. TOTAL over everything without a `dispose` member.
    (console.log "1 total:")
    (dispose [1 2 3])
    (dispose "abc")
    (dispose 42)
    (dispose nil)
    (dispose {:a 1})
    (console.log "  (no output above)")

    ;; 2. ...and calls it where there is one.
    (console.log "2 direct:")
    (dispose (Res 0))

    ;; 3. `take` abandons its source.
    (console.log "3 take 2 of 9:")
    (let r3 ((Res 0) |> (take 2) |> to-list))
    (console.log "  ->" (r3.join " "))

    ;; 4. `take-while` abandons at the first failure.
    (console.log "4 take-while < 3:")
    (let r4 ((Res 0) |> (take-while (fn [x] (< x 3))) |> to-list))
    (console.log "  ->" (r4.join " "))

    ;; 5. `zip` abandons both sides -- Letters runs out first, Res is left mid-sequence.
    (console.log "5 zip (2 vs 9):")
    (let r5 (count ((Res 0) |> (zip (Letters 0)))))
    (console.log "  ->" r5)

    ;; 6. a generator is PARKED, not cleaned up.
    (console.log "6 generator parking:")
    (fn :gen nats [] -> Iterator<Int> ((mut k 0) (while true ((yield k) (k := (+ k 1))))))
    (let g (nats))
    (console.log f"  first={(next g)}")
    (dispose g)
    (console.log f"  after-dispose-nil={(== (next g) nil)}")

    ;; 7. THE NEGATIVE HALF: a source with no `dispose` survives the same operators.
    (console.log "7 no-dispose source:")
    (let r7 ([10 20 30 40] |> (take 2) |> to-list))
    (console.log "  ->" (r7.join " "))
)

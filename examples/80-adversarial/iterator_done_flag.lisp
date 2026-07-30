;; D108: exhaustion is a FLAG, not the value. `Iterator<T>` carries `done` beside `next`.
;;
;; `nil MEANS done` made a nil ELEMENT indistinguishable from the end, so a walk of `[1 nil 2]`
;; stopped at the first one. The runtime had already fixed that for BUILT-IN cursors; this file
;; covers the two kinds it had not -- a USER cursor, and a GENERATOR -- plus the one that made the
;; whole thing hard to see: `for :each` has two lowerings, and only the ordinary one knew.
;;
;; Every source below deliberately carries a nil in the MIDDLE and then genuinely exhausts, because
;; a trailing nil cannot distinguish a correct walk from a truncated one.
(
    (import "std/protocols")
    (import "std/iter/linq")

    ;; 1. A USER CURSOR. `done` is post-hoc: `next` sets the flag on the call that runs out, and it
    ;;    is never recomputed from `i` -- recomputing would answer "would a FURTHER call be empty?",
    ;;    which reports done for the last real element.
    (defstruct Three :implements Iterator<Any>
        (mut :ctor i <- Int)
        (mut :ctor spent <- Boolean false)
        (fn iterator [] -> Iterator<Any> (return this))
        (fn next [] -> Any? (
            (let n this.i)
            (this.i := (+ n 1))
            (if (== n 0) (return 1))
            (if (== n 1) (return nil))
            (if (== n 2) (return 2))
            ((this.spent := true) (return nil))))
        (fn done [] -> Boolean (return this.spent)))

    (mut a 0)
    (for :each x :from (new Three 0) :then (a := (+ a 1)))
    (console.log "user cursor:" a)

    ;; 2. A GENERATOR with TOP-LEVEL yields. The frame's own state machine already recorded
    ;;    exhaustion in slot 0 (-1 is terminal); nothing read it.
    (fn :gen flat [] -> Iterator<Any> ((yield 1) (yield nil) (yield 2)))
    (mut b 0)
    (for :each x :from (flat) :then (b := (+ b 1)))
    (console.log "gen toplevel:" b)

    ;; 3. A GENERATOR whose yield is INSIDE A LOOP. This is the shape `std/iter/linq`'s operators
    ;;    have, and it failed while (2) passed -- `for :each` inside a `:gen` is lowered by a
    ;;    SEPARATE method that hand-built a `(el != nil)` test instead of the `ll_iter_done` the
    ;;    ordinary lowering emits. One rule, two lowerings, one of them taught.
    (fn :gen wrap [coll] -> Iterator<Any>
        (for :each x :from coll :then ((yield x))))
    (let xs <- Any [1 nil 2 nil 3])
    (mut c 0)
    (for :each x :from (wrap xs) :then (c := (+ c 1)))
    (console.log "gen in loop:" c)

    ;; 4. The consequence, end to end: the lazy operators are generators of shape (3).
    (console.log "linq seq:" ((xs |> seq) |> count))
    (console.log "linq map:" ((xs |> (map (fn [x] x))) |> count))

    ;; 4b. THE EARLY-EXIT operators. These drive their cursors BY HAND -- `take` must pull exactly
    ;;     `n` and never the (n+1)th, and `zip` advances two sources in lockstep, neither of which
    ;;     `for :each` can express -- so they tested `(== v nil)` in l-lang SOURCE and no runtime fix
    ;;     could reach them. They ask `iter-done` now (D108/B4).
    (console.log "linq take:" ((xs |> (take 5)) |> count))
    (console.log "linq takewhile:" ((xs |> (take-while (fn [x] true))) |> count))
    (let ys <- Any [10 20 nil])
    (console.log "linq zip:" ((xs |> (zip ys)) |> count))

    ;; 5. THE CONTROL. A built-in cursor over the same data -- fixed long before D108, and it must
    ;;    not move. If this ever disagrees with the rows above, the cursor kinds have drifted apart
    ;;    again, which is the whole failure this ruling exists to end.
    (mut d 0)
    (for :each x :from xs :then (d := (+ d 1)))
    (console.log "builtin:" d)
)

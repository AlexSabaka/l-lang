;; The iteration protocol lives in `std/protocols` (D107), not `std/iter`. This pins the three
;; reachability paths that the move created, because they are not obviously the same:
;;
;;   1. DIRECT     -- `(import "std/protocols")`, naming the contract's own module.
;;   2. TRANSITIVE -- `(import "std/iter")` alone still sees the names, because `std/iter` imports
;;                    `std/protocols` and a name reachable transitively resolves. This is the path
;;                    every pre-existing corpus file takes, so if it ever stops working the whole
;;                    corpus goes with it -- and it would go SILENTLY without LL0249 (B1), because an
;;                    unresolved `:implements` used to disable conformance rather than report it.
;;   3. NEITHER    -- LL0249, pinned separately in `90-diagnostics/ll0249_unresolved_implements.lisp`.
;;
;; `Disposable` is here too and that is the point of it: its own header argues it is NOT part of the
;; iteration protocol, so a file wanting a cleanup hook must not have to import an iteration module.
(
    (import "std/protocols")
    (import "std/iter")

    ;; --- 1. DIRECT: a cursor declared against the contract's own module. -----------------------
    (defstruct Countdown :implements Iterator<Int>
        (mut :ctor n <- Int)
        (mut :ctor spent <- Boolean false)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (<= this.n 0) ((this.spent := true) (return nil)))
            (let v this.n)
            (this.n := (- v 1))
            (return v)))
        (fn done [] -> Boolean (return this.spent)))

    (mut sum 0)
    (for :each x :from (new Countdown 4) :then (sum := (+ sum x)))
    (console.log "countdown sum:" sum)

    ;; The conformance CLOSURE has to survive the move: `Iterator :implements Iterable`, so a cursor
    ;; must answer `:of` for both. This is the thing a missed import silently switched off.
    (let c (new Countdown 1))
    (console.log "of Iterator:" (c :of Iterator))
    (console.log "of Iterable:" (c :of Iterable))

    ;; --- 2. Range still works, and it stayed in std/iter ---------------------------------------
    ;; `Range :implements Iterable<Int>` now reaches its interface across a package boundary, which
    ;; is the load-bearing case: if cross-module interface resolution were weak, this would be the
    ;; first thing to break.
    (mut rsum 0)
    ;; Adjacent `..`, deliberately: SPACED is a span (ELL0034), not a range, whatever the older
    ;; comments in `std/iter` and `16-stdlib/12_range.lisp` claim about permissive spacing.
    (for :each i :from (0..3) :then (rsum := (+ rsum i)))
    (console.log "range sum:" rsum)

    ;; --- 3. Disposable, from its new home, on a type with no iteration in sight ----------------
    (defclass Handle :implements Disposable
        (mut :ctor open <- Boolean)
        (fn dispose [] -> Void (this.open := false)))

    (let h (new Handle true))
    (console.log "before dispose:" h.open)
    (h.dispose)
    (console.log "after dispose:" h.open)
    (console.log "of Disposable:" (h :of Disposable))
)

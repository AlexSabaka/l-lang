;; CONFORMANCE guard: what a CURSOR is, and that both backends agree (S2b, gap-ledger 14.3).
;;
;; D30 splits the protocol in two -- `Iterable<T>` hands out a cursor, `Iterator<T>` IS one -- and
;; rules `Iterator<T> :implements Iterable<T>` so a cursor can stand wherever a source is wanted.
;; Two things made that ruling untrue on JS, and only on JS:
;;
;; A. THE BRIDGE WAS NOT TRANSITIVE. `[Symbol.iterator]` was injected by testing the literally-written
;;    `:implements` list for the name `Iterable`, so a type declaring the MORE PRECISE
;;    `:implements Iterator<T>` got no bridge at all -- `for :each` over it emitted `for (x of c)` and
;;    threw "is not iterable", while C drove it happily through `iterator()`. Declaring the better
;;    interface was the thing that broke. The corpus never caught it because its one hand-written
;;    cursor declares `:implements Iterable` directly.
;;
;; B. `iter` WRAPPED UNCONDITIONALLY. Every `(iter x)` answered a fresh anonymous `{next(){...}}`, so a
;;    JS cursor had no identity, no `dispose` and no type: `(type (iter c))` said `Map` where C said
;;    `Countdown`. That is the divergence D58's disposal ruling had to be AMENDED around -- "dispose
;;    the cursor" would have worked natively and silently done nothing here, so it became "dispose the
;;    collection" instead.
;;
;; WHAT EACH LINE PINS:
;;
;;   1. A type declaring `:implements Iterator<T>` drives `for :each`. This is (A), and it is the whole
;;      point of the sub-typing ruling.
;;   2. IDENTITY: `(iter c)` on a hand-written cursor is the cursor itself, because `iterator()`
;;      returns `this`. `==` is the weak form of the claim.
;;   3. The STRONG form, and the one that would catch a clone: pulling through the value `iter` handed
;;      back must advance the ORIGINAL. A copy would leave the original at 3 and quietly restart.
;;   4. A CONTAINER has no cursor of its own, so `iter` builds one -- it is NOT the array. Both
;;      backends make a wrapper here (C's is LL_H_CURSOR), so this arm always agreed; it is here so
;;      the file says which arm is which rather than implying every `iter` is identity.
;;   5. A fresh cursor per call is what makes a source re-walkable: two loops over one array both
;;      start over.
(
    (import "std/iter")

    ;; Declares the CURSOR interface, not the source interface -- the shape that used to break.
    (defclass Countdown :implements Iterator<Int>
        (mut :ctor n <- Int 3)
        (fn next [] -> Int? (
            (if (<= this.n 0) (return nil))
            (this.n := (- this.n 1))
            (return (+ this.n 1))
        ))
        (fn iterator [] -> Iterator<Int> (return this))
    )

    ;; 1. `for :each` drives a type that declares `Iterator<T>`.
    (mut seen "")
    (for :each x :from (new Countdown 3) :then (seen := (+ seen f"{(x)}")))
    (console.log "1" seen)

    ;; 2. IDENTITY -- the cursor of a cursor is itself.
    (let c (new Countdown 3))
    (console.log "2" (== (iter c) c))

    ;; 3. The strong form: pulling through the returned value advances the ORIGINAL.
    (let cur (iter c))
    (let a (next cur))
    (let b (next c))
    (console.log "3" a b c.n)

    ;; 4. A container gets a WRAPPER, not itself -- the other arm, and it always agreed.
    (let arr [1 2 3])
    (console.log "4" (== (iter arr) arr))

    ;; 5. A fresh cursor per call, so a source can be walked more than once.
    (mut first "")
    (mut second "")
    (for :each v :from arr :then (first := (+ first f"{(v)}")))
    (for :each v :from arr :then (second := (+ second f"{(v)}")))
    (console.log "5" first second)
)

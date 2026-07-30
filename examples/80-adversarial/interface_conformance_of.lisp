;; `:of` AGAINST A DECLARED INTERFACE, in the three shapes nothing pinned.
;;
;; This exists because a PREMISE went stale and two comments still repeat it. D58's amendment, and
;; `80-adversarial/disposal.lisp:11`, both say:
;;
;;     "`(x :of SomeInterface)` answers false on BOTH backends today, even for a type that declares
;;      `:implements`, so the mechanism the ruling named does not exist to call."
;;
;; That is measurably false now, and the gap ledger's companion note -- "`:implements A B` records
;; only the FIRST interface" -- is stale with it. All three rows below answer `true`, on both
;; backends. Nothing in the corpus asked, which is why nobody noticed the premise had expired.
;;
;; The consequence is a live design question, NOT closed here: `ll_dispose` still recognises its
;; target by looking for a `dispose` MEMBER rather than by testing `Disposable`, on exactly the
;; premise above. D58's own text rules the other way -- "dispose what is `Disposable`, leave
;; everything else alone" -- so the duck-typing is now a workaround for a defect that no longer
;; exists. Switching it is a semantic change (two corpus types have `dispose` and do NOT declare the
;; interface, and would stop being disposed), so it is recorded in docs/roadmap.md for a ruling.
(
    (import "std/protocols")

    ;; 1. A SINGLE declared interface.
    (defclass OnlyDisp :implements Disposable
        (mut :ctor n <- Int)
        (fn dispose [] -> Void (console.log "  disposed")))

    ;; 2. TWO interfaces on one declaration -- the shape the ledger says records only the first.
    (defclass Both :implements Iterator<Int> Disposable
        (mut :ctor n <- Int)
        (mut :ctor spent <- Boolean false)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (<= this.n 0) ((this.spent := true) (return nil)))
            (let v this.n)
            (this.n := (- v 1))
            (return v)))
        (fn done [] -> Boolean (return this.spent))
        (fn dispose [] -> Void (console.log "  disposed")))

    (let a (new OnlyDisp 1))
    (console.log "single:" (a :of Disposable))

    (let b (new Both 3))
    ;; the FIRST interface
    (console.log "first of two:" (b :of Iterator))
    ;; the SECOND -- this is the row the stale note says must be false
    (console.log "second of two:" (b :of Disposable))
    ;; 3. TRANSITIVE: `Iterator<T> :implements Iterable<T>`, so a cursor is an Iterable without
    ;;    naming it. This is what a missed import used to switch off silently, before LL0249.
    (console.log "transitive:" (b :of Iterable))

    ;; and the negative half, so the rows above mean something: a type declaring NEITHER answers false
    (defclass Plain (mut :ctor n <- Int))
    (let p (new Plain 1))
    (console.log "undeclared:" (p :of Disposable))
)

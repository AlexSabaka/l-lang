;; ADVERSARIAL: CALLING A METHOD ON SOMETHING YOU HAD TO COMPUTE FIRST.
;;
;; `(gs[0].hi)` is a call because `classifyList` asks `isDottedMemberIndexer` -- the suffix chain ENDS
;; in a dotted member, which is D1's rule that `(obj.m)` is a call while `(obj["m"])` is a read. The
;; callee is then an `indexer` node rather than a name, and the C backend had only a refusal for that:
;;
;;     ELL0106 Cannot generate C for 'computed-callee' (resolveCall)
;;
;; while `resolveCall`'s `member` case, ten lines above it, already did exactly this job for a computed
;; receiver arriving from the pipeline desugar. Two spellings of one thing; one of them lowered. This
;; is the dispatch-table shape -- an array or map of objects, dispatched by index -- and it is what
;; blocks `std/math/fft`.
;;
;; The chain is walked ONE INDEX SHORT rather than sliced, because `xs[0].a.b` may arrive as one member
;; group of two names or as two groups of one, and both spellings mean the same thing.
(
    (defclass Inner
        (let :ctor v)
        (fn twice [] -> Int (* (this.v) 2))
        (fn plus [n <- Int] -> Int (+ (this.v) n)))
    (defclass Outer
        (let :ctor inner))

    ;; -- a vector element, with ARGUMENTS ------------------------------------------------------------
    ;;
    ;; The index is not 0, so a lowering that reached the receiver by dropping the suffix entirely --
    ;; and read `xs` itself -- would answer with the first element and look plausible.

    (let xs [(new Inner 5) (new Inner 7)])
    (console.log "vector elem :" (xs[1].plus 3))

    ;; -- a MAP element, which reaches the receiver through a different index kind --------------------

    (let m {"a" (new Inner 9)})
    (console.log "map elem    :" (m["a"].twice))

    ;; -- and a chain: index, then a FIELD, then the method --------------------------------------------
    ;;
    ;; `os[0].inner.twice` has two dotted suffixes, and only the LAST one is the method. A split that
    ;; took the first dotted suffix would call `inner` and never reach `twice`.

    (let os [(new Outer (new Inner 4))])
    (console.log "nested field:" (os[0].inner.twice))

    ;; -- D1 MUST NOT MOVE ----------------------------------------------------------------------------
    ;;
    ;; A BRACKET suffix is a read, and stays one. `(m["f"] 5)` is a block -- the read, then 5 -- whose
    ;; value is 5, and turning it into a call is precisely what `IndexerNode.members` exists to prevent.
    ;; The lowering above returns `undefined` for a chain that does not end in a DOTTED member, so this
    ;; line never reaches it. Both backends have always answered 5 here and still do.

    (fn dbl [n <- Int] -> Int (* n 2))
    (let fs {"f" dbl})
    (console.log "bracket read:" (fs["f"] 5))
    (console.log "done")
)

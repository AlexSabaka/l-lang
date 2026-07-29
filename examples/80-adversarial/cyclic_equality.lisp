;; ADVERSARIAL: A STRUCTURE THAT REACHES ITSELF, HANDED TO `==`.
;;
;; `ll_deep_eq` walked a value graph as if it were a TREE. The JS shim opens with `if (a === b)
;; return true;` and the C one had no counterpart at all, so the two backends disagreed at the very
;; first question a cyclic value can be asked:
;;
;;     (== a a)   on a self-referential object  ->  SIGSEGV on C, `true` on JS
;;
;; Identity implying equality decides nothing that was not already decided -- it is the one case
;; where the recursive walk is provably redundant -- and it is the whole of that fix.
;;
;; THE SECOND QUESTION IS NOT DECIDED, AND THIS FILE DOES NOT DECIDE IT. Two DISTINCT structures that
;; each reach themselves have no finite walk. Co-inductive equality would answer `true`; nothing in
;; DECISIONS.md has ruled it, and the oracle does not rule it either -- it blows its own call stack on
;; the same program. So the comparison REFUSES: a depth budget turns an unbounded recursion into a
;; bounded, catchable, located failure, which is a safety property rather than an answer. Whether the
;; twins are equal remains an open question in docs/roadmap.md.
;;
;; The two backends fail differently in TEXT -- C reports its own message, JS reports its host's
;; "Maximum call stack size exceeded" -- so nothing here prints the message. What is asserted is the
;; shape both must share: it is catchable, and the program keeps going.
(
    (defclass Node
        (let :ctor next))

    ;; -- the case that crashed: a value compared with ITSELF ----------------------------------------

    (let a (new Node nil))
    (a.next := a)
    (console.log "self identical :" (== a a))

    ;; -- the case nobody has ruled: two DISTINCT self-referential values ---------------------------
    ;;
    ;; The budget is 10000 and the recursion is per LEVEL, not per element -- a million-element vector
    ;; is depth 1 -- so nothing a program builds by nesting can reach it by accident.
    ;;
    ;; Catching it needs the kind to name a class the module actually has (D82). The first spelling of
    ;; this trap was `ValueError`, which is NOT in the ambient tower, so it stayed fatal and escaped a
    ;; `catch` that handled it perfectly on the oracle -- a fix that swapped one uncatchable failure
    ;; for another. `RangeError` is ambient, and is what the host raises for the same condition.

    (let b (new Node nil))
    (b.next := b)
    (try (console.log "twins          :" (== a b))
     catch e :of Error (console.log "twins          : refused, and the program continued"))

    ;; -- and the identity short-circuit must not swallow the STRUCTURAL walk -----------------------
    ;;
    ;; `==` stays deep for everything that terminates: two distinct-but-equal values are equal, two
    ;; that differ are not. A short-circuit that answered only for identical pointers would turn `==`
    ;; into `is`, silently, and every one of these would still "pass" if it printed nothing.

    (console.log "distinct equal :" (== [1 2 3] [1 2 3]))
    (console.log "distinct differ:" (== [1 2 3] [1 2 4]))

    ;; A finite chain of three links, compared against an equal one built separately: the walk really
    ;; does descend, and the depth counter does not fire on ordinary nesting.
    (let c3 (new Node nil))
    (let c2 (new Node c3))
    (let c1 (new Node c2))
    (let d3 (new Node nil))
    (let d2 (new Node d3))
    (let d1 (new Node d2))
    (console.log "finite chain   :" (== c1 d1))

    ;; The fast path on an ordinary, acyclic value: same answer as before, arrived at sooner.
    (let v [1 2 3])
    (console.log "same vector    :" (== v v))
    (console.log "done")
)

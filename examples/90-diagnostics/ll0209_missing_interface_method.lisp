;; LL0209 -- `:implements` CLAIMS SOMETHING, and the claim is checked. The claim being FALSE had no
;; negative file of its own: `ll0249_unresolved_implements.lisp` covers `:implements` naming something
;; unreachable, which is the other half, and its note records that the two were once collapsed into a
;; single `continue` so that a missing import turned LL0209 off silently. This pins the half that
;; fires when the interface DOES resolve.
;;
;; BOTH A CLASS AND A STRUCT, for the reason that file states: the check was typed for class and
;; struct and wired only for class, so a struct's `:implements` went unverified entirely. A regression
;; that re-broke only the struct arm would otherwise pass on the class row alone.
;;
;; WHAT THIS DOES NOT PIN, and what is recorded in docs/roadmap.md instead: conformance checks the
;; method's NAME and not its SIGNATURE. A `dispose` declared `[k <- Int] -> Int` instead of
;; `[] -> Void` satisfies `:implements Disposable`, answers `(x :of Disposable)` true on both
;; backends, and then traps at runtime on C (`TypeError: expected an Int`) or answers silently wrong
;; on JS. Pinning today's answer for that would pin the defect.
(
    (import "std/protocols")

    ;; a CLASS that claims Disposable and defines no `dispose`
    (defclass NoDispose :implements Disposable
        (mut :ctor n <- Int))

    ;; a STRUCT making the same false claim -- the arm that was once unwired
    (defstruct AlsoNone :implements Disposable
        (mut :ctor n <- Int))

    ;; and a claim missing SEVERAL members at once: `Iterator<T>` requires `next` AND `done`, and
    ;; `iterator` transitively through `Iterable<T>`. Defining one of the three is not conformance.
    (defclass HalfCursor :implements Iterator<Int>
        (mut :ctor n <- Int)
        (fn next [] -> Int? (return nil)))
)

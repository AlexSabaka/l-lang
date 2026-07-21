;; ADVERSARIAL (regression guard): `(call f)` -- invoking a ZERO-ARGUMENT function value.
;;
;; D1 makes a bare `(f)` a READ of the binding, not a call, so a zero-arg closure has no other
;; spelling: `(call f)` is the only way to invoke one. The desugarer turns it into a core CallNode
;; (DesugarAstVisitor.transformCall) precisely to record "this is unambiguously a call".
;;
;; The C backend then handed that CallNode back to the same resolver a bare list uses, which re-applied
;; D1's zero-arg READ rule and produced the closure VALUE instead of invoking it. Silent where the
;; result was printed, and a hard `C emit: no cast closure -> bool` where a `for :cond` tried to test
;; it. JS was always correct -- `call` is a runtime shim there (`f => f()`).
;;
;; Covers the shapes that differ in how the callee is bound: a let-bound lambda, a let-bound reference
;; to a declared function, and a closure that captures.
(
    (let greet (fn [] "hello"))
    (console.log "lambda:" (call greet))

    (fn shout [] "HEY")
    (let s shout)
    (console.log "fn-ref:" (call s))

    (let n 7)
    (let peek (fn [] (* n 6)))
    (console.log "capturing:" (call peek))

    ;; A zero-arg closure in a boolean position -- the shape that failed to emit at all.
    (let ready (fn [] true))
    (if (call ready) (console.log "cond: ready") (console.log "cond: not ready"))
)

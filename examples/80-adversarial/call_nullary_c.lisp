;; CONFORMANCE guard: `(call f)` -- D1's escape hatch -- works on BOTH backends.
;;
;; D1 rules that `(x)` is a READ of `x`, not a zero-argument call. That makes `call` the ONLY way to
;; invoke a nullary function from source, which makes it a LANGUAGE primitive rather than a host
;; convenience -- and it lived only in the JS shim's SYMBOL_MAP, unmodelled, so on C every nullary
;; API was simply unreachable: `ELL0107: 'call' resolves to a JavaScript host global`.
;;
;; `call_zero_arg_closure.lisp` already pins the `for :cond` case. This one pins the two shapes that
;; still failed, and they failed for two different reasons, neither of them about `call`:
;;
;;   1. `no cast closure -> closure`. Every arm of the emitter's cast table converts between two
;;      DIFFERENT representations, so an IDENTITY cast fell off the end and threw -- an uncaught
;;      exception with a bare stack trace, not a diagnostic. P2 legitimately produces one: it inserts
;;      a cast wherever declared and actual ctypes are not the same OBJECT, and two structurally
;;      equal `closure` types are not.
;;
;;   2. A closure call CLAIMED THE WRONG RETURN TYPE. `ll_call` returns a boxed `ll_value` -- that is
;;      what "the uniform boxed calling convention" means -- but the CIR node claimed the closure's
;;      DECLARED return ctype, so the emitter boxed an already-boxed value with the wrong boxer:
;;      `ll_box_str(ll_call(...))`, passing an `ll_value` where `ll_str*` was expected. Only reachable
;;      through a closure with a concrete return ctype, which is why a `-> String` lambda found it and
;;      every `-> Void` or already-boxed one did not. The unbox belongs to P2, the coercion pass, and
;;      is inserted at the consumer -- building it during resolution would fuse cast insertion into
;;      resolution, which InsertCoercions' own header rules out.
;;
;; Fixing these promoted `01-functions/03_higher_order_functions.lisp`, which had been sitting behind
;; a c-status comment claiming it was a PARSE failure. It was not; it had not been re-measured.
(
    ;; A named top-level nullary. Lowers to a DIRECT call on C -- no closure involved.
    (fn make-answer [] -> Int (return 42))
    (console.log "named:  " (call make-answer))

    ;; A nullary LAMBDA held in a binding: the boxed calling convention, and the shape that exposed
    ;; the return-type lie. `-> String` is load-bearing -- a concrete ctype is what makes it visible.
    (let greet (fn [] -> String (return "hello")))
    (console.log "lambda: " (call greet))

    ;; A nullary returning a container, so the boxed path is exercised with a non-scalar too.
    (let make-list (fn [] -> Int[] (return [1 2 3])))
    (console.log "vector: " (call make-list))
)

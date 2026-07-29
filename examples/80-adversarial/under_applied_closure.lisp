;; ADVERSARIAL: `(argc, argv)` IS AN UNCHECKED PAIR, AND THE CALLEE MUST NOT TRUST THE COUNT.
;;
;; A call whose callee is KNOWN has its arity checked at compile time -- `(g 7)` on a two-parameter
;; `g` is LL0211 and never reaches the backend. A callee reached as a VALUE has no such site: it
;; arrives through `ll_call` as a flat `(argc, argv)`, and nothing between the call and the callee
;; compares that count against the arity.
;;
;; All three C entry points that unpack it -- a lifted closure, a method's dynamic-dispatch adapter,
;; and a top-level function used as a value -- read `__argv[i]` unconditionally. So every shape below
;; READ PAST THE END of the caller's array. Measured before the fix:
;;
;;     (f 7) on (fn [a b])   ->  [7 #<object>]        JS: [7 nil]
;;     (call f) on (fn [a b]) ->  SIGSEGV, exit 139   -- `argv` is NULL for a zero-argument call
;;
;; THE WHOLE PROGRAM BELOW PRINTED NOTHING AT ALL and exited 139 before the fix, because the first
;; line is the nullary one. That is worse than the audit recorded, which had only the `#<object>`.
;;
;; AND ONE SHAPE LOOKED CORRECT WHILE BEING UNDEFINED. A call site builds its arguments as a compound
;; literal; the stack slot after a one-element one happened to hold zero, and `LL_NIL == 0`, so the
;; out-of-bounds read decoded as nil and printed the right answer for the wrong reason. Undefined
;; behaviour that agrees with the oracle is still undefined behaviour -- which is why the fix went to
;; all three sites, and why this file asserts the shapes that were already "passing".
(
    (fn call0 [f] (return (call f)))
    (fn call1 [f x] (return (f x)))
    (fn call3 [f a b c] (return (f a b c)))

    ;; -- a closure reached as a value, called with FEWER arguments than it declares -----------------
    ;;
    ;; A missing argument is nil, which is what JS binds. It is not an in-band lie in D9's sense: these
    ;; parameters are untyped, and nil is a value of that type. Where a parameter has a CONCRETE type
    ;; the unbox traps ("expected an Int") instead of computing on garbage -- the same answer one rung
    ;; louder, and not asserted here because the deprecated backend dies with an uncaught host
    ;; TypeError on the same program rather than reporting anything.

    (let pair (fn [a b] (return [a b])))
    (console.log "one of two :" (call1 pair 7))

    ;; -- ZERO arguments, where `argv` is not merely short but NULL ----------------------------------
    ;;
    ;; D1 makes `(f)` a READ of `f`, so `call` is the only way to spell a no-argument invocation --
    ;; and `ll_call_dyn` passes `(0, (ll_value*)0)` for it. `__argv[0]` on a null pointer is not a
    ;; wrong value, it is a fault, and this is the line that took the whole program down.

    (console.log "zero of two:" (call0 pair))

    ;; -- MORE arguments than declared, which must stay harmless ------------------------------------
    ;;
    ;; The guard is `__argc > i`, not `__argc == arity`: over-application drops the extras, as it did
    ;; before. A fix that turned this into a refusal would be a language change nobody ruled.

    (console.log "three of two:" (call3 pair 1 2 3))

    ;; -- a REST parameter was already clamped, and stays clamped -----------------------------------
    ;;
    ;; `[...more]` packs `__argc - i` values and already refused to trust the count -- it clamps at
    ;; zero so a short call gives an empty rest rather than a negative length. That guard was written
    ;; for exactly this hazard and then not extended to the fixed parameters beside it.

    (let head-and-rest (fn [a ...more] (return [a more.length])))
    (console.log "rest short :" (call1 head-and-rest 9))

    ;; -- a TOP-LEVEL function used as a value goes through an adapter, which had the same read ------
    ;;
    ;; This is the shape that printed `[7 nil]` before the fix and prints `[7 nil]` after it. The
    ;; assertion is not that the answer changed; it is that the answer is now DEFINED.

    (fn top-pair [a b] (return [a b]))
    (console.log "adapter    :" (call1 top-pair 7))

    ;; -- and a METHOD on a statically-unknown receiver, through the dispatch table ------------------
    ;;
    ;; `o` is untyped, so `(o.pair 5)` cannot devirtualise and goes through the boxed method adapter --
    ;; the third site, and the one furthest from where a reader would look for an argv bug.

    (defclass Holder
        (let :ctor n)
        (fn pair [p q] (return [p q])))
    (let h (new Holder 1))
    (let via-dispatch (fn [o] (return (o.pair 5))))
    (console.log "method     :" (via-dispatch h))

    ;; -- the missing argument is really nil, not merely something that PRINTS as nil ---------------

    (let second (fn [a b] (return b)))
    (let missing (call1 second 1))
    (console.log "is nil     :" (== missing nil))
    (console.log "done")
)

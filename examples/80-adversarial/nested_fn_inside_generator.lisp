;; A NESTED FUNCTION INSIDE A GENERATOR LOST ITS OWN BODY.
;;
;; `inGenerator` is a flag on the RESOLVER, but it describes the function being resolved. A nested
;; `fn` declared inside a `:gen` body inherited it, and the `return` arm rewrites a return into the
;; generator's park-and-answer-nil epilogue whenever it is set (D31/D58 -- `return` ends the sequence).
;; So this helper:
;;
;;     (fn dbl [x <- Int] -> Int (return (* x 2)))
;;
;; emitted `__ll_gen_state = -1; return ll_nil();` as its ENTIRE body -- naming a frame slot that
;; exists only inside the enclosing generator's step function, so the C did not compile. Had it
;; compiled it would have been worse than a build failure: `dbl` would answer nil instead of 8, and
;; nothing in the type system would have objected.
;;
;; TWO COPIES OF ONE DECISION, BOTH MISSING THE SAME FIELD. `isolated()` saves and resets the state a
;; C function must not inherit -- scopes, cellVars, inFunctionBody, selfClass -- and the lambda lifter
;; keeps its own inline copy of that same list. Neither included `inGenerator`. Fixing `isolated()`
;; alone left this program broken, because a nested `fn` is LIFTED and never reaches it; the lifter's
;; copy is the load-bearing one, and `isolated()`'s is kept so the two agree.
;;
;; THE LAST GENERATOR IS THE CONTROL AND IS THE POINT. The flag is not wrong -- a `return` in the
;; generator's OWN body must still park the machine, or the next pull would dispatch back to the last
;; suspend and re-run the tail forever. If `parks:` ever prints 99, the fix has been over-applied.
(
    (import "std/protocols")

    ;; 1. A nested named `fn` with its own `return`, called on BOTH sides of a suspension.
    (fn :gen doubling [] -> Iterator<Int> (
        (fn dbl [x <- Int] -> Int (return (* x 2)))
        (yield (dbl 4))
        (yield (dbl 5))))

    ;; 2. An EARLY return inside the nested function -- two returns, neither of them the generator's.
    (fn :gen clamping [] -> Iterator<Int> (
        (fn clamp [x <- Int] -> Int ((if (> x 10) (return 10)) (return x)))
        (yield (clamp 3))
        (yield (clamp 42))))

    ;; 3. A lambda bound to a name and called -- the same lifter, reached as a VALUE rather than a
    ;;    declaration, so the two entries to `resolveLambda` are both covered.
    (fn :gen lambda-bound [] -> Iterator<Int> (
        (let f (fn [x <- Int] -> Int (return (+ x 1))))
        (yield (f 6))
        (yield (f 7))))

    ;; 4. THE CONTROL: the generator's own `return` still ENDS THE SEQUENCE (D31/D58). The 99 below
    ;;    must never be reached.
    (fn :gen parks [] -> Iterator<Int> (
        (yield 1)
        (return)
        (yield 99)))

    (fn dump [tag <- String  it <- Any] -> Void (for :each x :from it :then (console.log tag x)))
    (dump "doubling:" (doubling))
    (dump "clamping:" (clamping))
    (dump "lambda-bound:" (lambda-bound))
    (dump "parks:" (parks))
)

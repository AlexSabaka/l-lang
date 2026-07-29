;; ADVERSARIAL: A DESTRUCTURED PARAMETER IS A PROLOGUE, AND EVERY EMITTER MUST BUILD IT.
;;
;; C has no destructured parameter, so `(fn print-point [[x y]] …)` becomes an ordinary boxed
;; parameter under a synthetic name plus the statements `(let [x y] p)` would emit. Same lowering,
;; reached from the other side -- so both go through one `emitPatternBind`, because writing it twice
;; is how the two would drift.
;;
;; THE HAZARD IS NOT THE LOWERING, IT IS THE WIRING. `declareParam` has EIGHT call sites and only FOUR
;; build a prologue. Returning the statements would let the other four drop a parameter's bindings
;; SILENTLY -- a function whose body reads names nothing declared. So they go on a queue that
;; `resolveFunctionBody` drains and that `isolated` asserts is EMPTY on the way out: a path that
;; declares such a parameter and never builds a prologue is refused BY NAME
;; (`param-destructuring-undrained`) instead of emitting a broken function.
;;
;; This file therefore exercises the SEAMS, not the syntax -- a plain function, a lambda, and a
;; method are three different emitters, and a fix that taught only the first would pass a file that
;; only tested the first.
;;
;; AND THE SIGNATURE HAD TO LEARN IT TOO. The checker types `[[x y]]`'s parameter `Int[]`, so the
;; signature said `ll_vec*` while the definition said `ll_value` and `cc` rejected every call site:
;; "passing 'll_vec *' to parameter of incompatible type 'll_value'". A destructured parameter is the
;; third thing that overrides the checker in `registerTopLevel`, beside a rest parameter and an
;; annotation.
(
    ;; -- a plain top-level function, vector and map ---------------------------------------------------

    (fn print-point [[x y]] (console.log "point  :" x y))
    (print-point [5 10])

    (fn greet [{:name :age}] (console.log "greet  :" name age))
    (greet {:name "Ada" :age 36})

    ;; -- the pattern features compose inside a parameter ---------------------------------------------
    ;;
    ;; A tail, and a nested pattern. Neither is special-cased for parameters; they are the same
    ;; recursion the declaration form uses, which is the point of sharing the emitter.

    (fn head-tail [[h ...t]] (console.log "tail   :" h t t.length))
    (head-tail [1 2 3])

    (fn deep [{:user {:name n :id i}}] (console.log "nested :" n i))
    (deep {:user {:name "Bob" :id 7}})

    ;; -- MIXED with ordinary and rest parameters -----------------------------------------------------
    ;;
    ;; The destructured parameter is in the MIDDLE, so a lowering that assumed it was the only one, or
    ;; the first, mis-numbers everything after it.

    (fn mixed [tag [x y] ...rest] (console.log "mixed  :" tag x y rest))
    (mixed "t" [5 6] 7 8)

    ;; -- A LAMBDA, which is a different emitter (the lift path) --------------------------------------

    (let f (fn [[a b]] (console.log "lambda :" a b)))
    (call f [1 2])

    ;; -- A METHOD, which is a third one, and which also has a receiver to keep straight --------------

    (defclass Box
        (let :ctor n)
        (fn show [[p q]] (console.log "method :" p q this.n)))
    (let bx (new Box 9))
    (bx.show [3 4])
    (console.log "done")
)

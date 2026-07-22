;; CONFORMANCE guard: a native container search with a numeric needle finds the element.
;;
;;     (let nums [1 2 3])
;;     (nums.includes 2)      ->  true      on both backends
;;
;; This answered FALSE on JS. The array holds BigInts -- the checker typed its elements `Int`, and
;; D51 makes an Int a BigInt -- while the LITERAL needle stayed a host Number, and SameValueZero is
;; false across BigInt and Number. C promoted both and found it, which is also what D51's numeric
;; `==` says the answer is.
;;
;; The cause was not the runtime and not `NUMERIC_HOST_PARAMS`. An integer literal only EMITS as a
;; BigInt when `intLiteral` finds an `Int` type on the node, and a type only gets there by inference
;; -- and the native-method branch of the checker returned its result WITHOUT inferring the
;; arguments, on the (correct) grounds that a native method's parameters are the host's business and
;; must not be arity-checked. Inferring and checking are different things, and collapsing them opted
;; every native-method argument out of the numeric floor.
;;
;; The `var-` lines are what isolated it: bind the same 2 to an `Int` variable and JS always got it
;; right, because a variable's type comes from its declaration rather than from the call site. So the
;; answer was never a function of the values -- only of which nodes inference had reached.
(
    (let nums [1 2 3])
    (mut needle <- Int 2)

    (console.log "lit-includes: " (nums.includes 2))
    (console.log "lit-indexOf:  " (nums.indexOf 2))

    ;; The same 2, reached through an Int-typed binding instead of a literal.
    (console.log "var-includes: " (nums.includes needle))
    (console.log "var-indexOf:  " (nums.indexOf needle))

    ;; A control: Reals are host Numbers on both sides, so this path was never affected.
    (let reals [1.5 2.5])
    (console.log "real-includes:" (reals.includes 2.5))
)

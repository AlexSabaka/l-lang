;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): a native container search with a numeric
;; needle must find the element.
;;
;; `(let nums [1 2 3])` then `(nums.includes 2)` answers **false** on JS, and `(nums.indexOf 2)`
;; answers **-1**. The array holds BigInts, because the checker typed its elements `Int` and D51 makes
;; an Int a BigInt -- but the LITERAL needle at a native-member argument position is not given that
;; type, so it arrives as a host Number, and `Array.prototype.includes` uses SameValueZero, which is
;; false across BigInt and Number. C's `ll_strict_eq` promotes both to a double and finds it.
;;
;; The line that isolates it is `var-includes`: bind the same 2 to an `Int`-typed variable and JS gets
;; it RIGHT. So this is not about the values at all -- it is about which of them the checker reached.
;; `EmitHirToEstree`'s `NUMERIC_HOST_PARAMS` coerces `indexOf`'s argument 1 (the from-index) and says
;; in as many words "never the needle", which was the correct call for a from-index and left the
;; needle behind.
;;
;; C is the reference here, and is right on the language's own terms: D51 rules `==` numeric across
;; Int and Real, so a search for a value equal to an element has to find it. The obvious repair --
;; coercing the needle with `__ll_hostnum` -- goes the WRONG WAY: it would turn a BigInt needle into a
;; Number and give back exactly the above-2^53 collapse that Fg-1 removed from `ll_deep_eq`. A real
;; fix has to lift the needle TO BigInt when the receiver holds them, which is not statically knowable
;; in general, so this is listed in `js-status.ts` rather than patched.
;;
;; Nothing in the corpus is hit: every other `.includes`/`.indexOf` call site is on a STRING.
;; `std/seq`'s `includes`/`index-of` are unaffected -- they route through `==`, which is numeric on
;; both backends (see `seq_structural_search.lisp`).
;;
;; EXPECTED == golden. ACTUAL under JS today: the two `lit-` lines answer `false` and `-1`.
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

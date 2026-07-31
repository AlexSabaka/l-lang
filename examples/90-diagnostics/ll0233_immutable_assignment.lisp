;; LL0233 (D10) -- a binding is IMMUTABLE unless declared `mut`, and it had no negative file.
;;
;; The enforcement site's own comment records why that matters: D10 was "ruled and then deliberately
;; parked (P8), enforced only by the accident of `let`->`const` at the JS backend -- so it did nothing
;; on any other target and reported nothing. Now checked." A rule that was dormant for most of its
;; life, switched on recently, with nothing in the corpus asking whether it fires.
;;
;; THREE TARGETS, because `mutability` is computed per symbol and the three arrive by different
;; routes: an ordinary `let`, a PLAIN PARAMETER (params-immutable-too is the ruled stance -- a
;; parameter is bound once, like Rust), and a name bound by DESTRUCTURING, which is the one most
;; likely to be missed since it never passes through a `variable` node of its own.
;;
;; WHAT IS LEGAL AND DELIBERATELY NOT HERE: `x.field := v` and `x[i] := v` on a `let`-bound value.
;; The check fires only for a BARE NAME target, by ruling -- those mutate what `x` points at rather
;; than the binding, and the games CP-cluster relies on it. A separate open question, recorded in
;; docs/roadmap.md, is whether a FIELD's own `let :ctor` versus `mut :ctor` spelling carries any
;; mutability contract; today it does not, and both spellings accept assignment.
(
    ;; 1. an ordinary `let`
    (let x 1)
    (x := 2)

    ;; 2. a PLAIN PARAMETER -- immutable by the same rule
    (fn f [p <- Int] -> Int ((p := 9) (return p)))

    ;; 3. a name bound by DESTRUCTURING
    (let [a b] [1 2])
    (a := 9)
)

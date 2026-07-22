;; NEGATIVE: a `Real` is not a container key -> LL0203.
;;
;; The ruling (D53, F.5): a key is an `Int` or a `String`. `get`/`elem` declare that on the floor, so
;; a Real key is refused at the CALL SITE rather than answered differently by each backend.
;;
;; It had to become a diagnostic, because no runtime could converge it. C rejects a Real key
;; (`ll_get` tests `k.tag != LL_INT`); JS cannot make that test at all, because after D51 an `Int` is
;; a BigInt only where the CHECKER typed it -- so an untyped integral value arrives as a plain Number
;; and the accessor must accept one, or `(get v 1)` stops working in untyped code. That is the same
;; concession `__ll_is_type`'s `case 'int'` already makes. `(Math.floor 1.7)` produces an integral
;; Number and slipped through exactly that hole, answering 20 on JS against nil on C.
;;
;; D51 amendment (b) types every `Math.*` except `trunc` as `-> Real` for precisely this purpose: the
;; narrowing has to be written down at the site that wants it. `(get v (Math.trunc 1.7))` is the
;; supported spelling and is green on both backends -- see `80-adversarial/container_accessors.lisp`.
;;
;; Also pins the OTHER wrong key kind: a Boolean is not a key either.
(
    (let v [10 20 30])
    (console.log (get v (Math.floor 1.7)))
    (console.log (elem v (Math.floor 1.7)))
    (console.log (get v true))
)

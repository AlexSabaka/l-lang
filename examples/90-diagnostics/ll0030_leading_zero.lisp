;; NEGATIVE: a leading zero names no radix -> LL0030 (D71).
;;
;; This pins the refusal that makes retiring bare-octal safe. `OctalNumber` used to be `/0[0-7]+/`, so
;; `017` meant 15; the spec rejects that spelling by name and requires `0o17`, which did not exist.
;; Dropping the old token alone would have left `017` matching as a DECIMAL integer -- the same source
;; quietly changing from 15 to 17 -- so the leading zero has to be refused outright, not re-read.
(
  (console.log 0001234)
)

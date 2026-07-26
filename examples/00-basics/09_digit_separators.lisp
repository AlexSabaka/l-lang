;; Digit separators in numeric literals (D71).
;;
;; `_` groups digits and means nothing to the value: `1_000_000` IS `1000000`. Python's strict rule --
;; a single `_` between digit groups, so `_1`, `1_` and `1__0` are not literals at all.
;;
;; The separator is stripped where the token becomes a node, so nothing downstream knows it existed.
;; That is deliberate and load-bearing rather than tidy: the C backend reads the literal's raw text as
;; the only lossless copy of a big integer, and would have fallen back to a JS `number` -- already
;; rounded past 2^53 -- for any literal carrying one. See 80-adversarial/digit_separator_precision.
(
    ;; Grouping a large constant, which is the whole point.
    (let population 8_045_311_447)
    (console.log "grouped:" population)

    ;; The value is identical to the ungrouped spelling. Grouping is presentation, not semantics.
    (console.log "identical:" (== 1_000_000 1000000))

    ;; Reals group the integer part the same way.
    (let budget 1_250_000.75)
    (console.log "real:" budget)

    ;; Grouping need not be in threes -- the rule is "between digits", not "every three".
    (console.log "irregular:" 1_2_3)

    ;; Arithmetic is arithmetic; there is nothing special about a grouped operand.
    (console.log "arithmetic:" (+ 1_000 2_000))

    ;; And a leading zero is NOT a way to pad: it names no radix and is refused (LL0030).
    ;; See 90-diagnostics/ll0030_leading_zero.lisp.
    (console.log "zero:" 0)
    (console.log "zero real:" 0.5)
)

;; A digit-separated integer PAST 2^53, which is the case where D71's stripping stops being cosmetic.
;;
;; `ResolveHirToCir` treats a literal's raw matched text as "the only lossless copy on the node" and
;; guards it with `/^[+-]?\d+$/` before trusting it; anything failing that guard falls back to
;; `String(node.value)`, and `value` is a JS number, which has already rounded. An underscore fails
;; that guard. So had `match` kept its separators, every literal big enough to WANT grouping would
;; have silently lost precision on C -- reintroducing, through the new feature, exactly the bug those
;; guards were added to fix.
;;
;; Grouping is also what makes such a literal readable, so the two features meet precisely here.
(
    ;; 2^53 + 1 -- the first integer a double cannot represent. If the raw text were dropped, this
    ;; prints 9007199254740992: even, and one less than it should be.
    (console.log "2^53+1:" 9_007_199_254_740_993)

    ;; The same value written without separators, to prove grouping changed nothing.
    (console.log "ungrouped:" 9007199254740993)
    (console.log "equal:" (== 9_007_199_254_740_993 9007199254740993))

    ;; Near Int64's ceiling, where a double is wrong by hundreds.
    (console.log "big:" 4_611_686_018_427_387_903)

    ;; Negative, since the sign is outside the digit run and must not disturb the stripping.
    (console.log "negative:" -9_007_199_254_740_993)

    ;; Arithmetic on it stays exact -- the literal reaches the backend as an int64, not a double.
    (console.log "exact math:" (- 9_007_199_254_740_993 1))
)

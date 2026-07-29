;; CONFORMANCE guard: the Tier-0 string shelf -- ASCII char classes, and integer parsing with its
;; try- twin. Everything here is pure l-lang over codepoints, so the two backends must agree exactly;
;; the interesting lines are the OVERFLOW boundaries, where D51's 64-bit wrap could make a naive
;; implementation diverge.
;;
;; WHAT EACH LINE PINS:
;;   1-5  the ASCII classes over a codepoint (Int): digit, alpha, alnum, space, and the case pair.
;;   6-7  the happy path: sign, leading `+`, leading zeros.
;;   8-9  the STRICT grammar answering nil -- empty, a lone sign, a trailing non-digit, surrounding
;;        whitespace. `try-parse-int` never throws; it says nil.
;;   10   +INT64_MAX exactly, and MAX+1 -> nil. MAX+1 measured as INT64_MIN under D51's wrap, so this
;;        only passes if the check PREDICTS overflow instead of computing it.
;;   11   -INT64_MIN exactly (the value whose magnitude has no positive twin), and MIN-1 -> nil.
;;   12-13 the throwing twin: `parse-int` returns the value, or throws an ordinary Error a `catch`
;;        can name -- the `read-file` / `try-read-file` convention, applied to parsing.
(
    (import "std/core/string")

    ;; nil-or-value as a STABLE string, so the golden does not depend on how a nil Int prints.
    (fn show [s <- String] -> String (
        (let r (try-parse-int s))
        (return (if (== r nil) "nil" f"{(r)}"))
    ))

    ;; 1-5. char classes, fed real codepoints via `codepoint-at`.
    (console.log "1" (is-digit (codepoint-at "5" 0)) (is-digit (codepoint-at "A" 0)))
    (console.log "2" (is-alpha (codepoint-at "A" 0)) (is-alpha (codepoint-at "5" 0)))
    (console.log "3" (is-alnum (codepoint-at "5" 0)) (is-alnum (codepoint-at " " 0)))
    (console.log "4" (is-space (codepoint-at " " 0)) (is-space (codepoint-at "A" 0)))
    (console.log "5" (is-upper (codepoint-at "A" 0)) (is-lower (codepoint-at "A" 0)) (is-upper (codepoint-at "a" 0)))

    ;; 6-7. the happy path.
    (console.log "6" (show "42") (show "-42") (show "+42"))
    (console.log "7" (show "0") (show "-0") (show "007"))

    ;; 8-9. the strict grammar -- every one is nil.
    (console.log "8" (show "") (show "+") (show "-"))
    (console.log "9" (show "12x") (show " 5") (show "5 "))

    ;; 10-11. the overflow boundaries.
    (console.log "10" (show "9223372036854775807") (show "9223372036854775808"))
    (console.log "11" (show "-9223372036854775808") (show "-9223372036854775809"))

    ;; 12-13. the throwing twin.
    (console.log "12" (parse-int "42"))
    (try (parse-int "bad")
         catch e :of Error (console.log "13" e.message))
)

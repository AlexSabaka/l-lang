;; NEGATIVE: a regex pattern nested inside another pattern -> LL0035 (D67).
;;
;; `r"…"` in pattern position is sugar for a `:when` guard, and the rewrite happens at the match ARM,
;; where there is a subject to bind and guard on. Nested inside a vector or map pattern there is no
;; such place -- the element is being DESTRUCTURED, not tested.
;;
;; Refused rather than left alone, because leaving it is silent and wrong: the node would stay an
;; ordinary constant pattern and match by EQUALITY against the pattern's own text, so the arm below
;; would quietly test whether the first element is the four characters `\d+`. No error, no match, and
;; nothing to suggest the regex was never run.
;;
;; The remedy the diagnostic names works today: bind the part, then test it with `:when`.
(
  (import "std/text/regex")

  (fn f [v <- String[]] -> String (
     (match v {
        [r"\d+" rest] => "starts with digits"
        _             => "other"
     })
  ))

  (console.log (f ["12" "x"]))
)

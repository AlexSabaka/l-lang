;; ADVERSARIAL: a `match` arm whose body is a bare `(if ...)` (finding CF3, l-lang-ex
;; minesweeper). Same family as CF1/CF2 -- `if` in value position.
;;
;; An arm `n :when (! revealed) => (if flagged "F" ".")` used to be SILENTLY SKIPPED: the
;; whole arm vanished and the match fell through to a later arm, so `(glyph 3 false false)`
;; rendered "3" instead of ".". No error at compile or run -- just the wrong glyph. FIXED at
;; HEAD (the arm fires and its inner if is evaluated).
(
  (fn glyph [count <- Int flagged <- Boolean revealed <- Boolean] -> String
    (match count {
      n :when (! revealed) => (if flagged "F" ".")
      0                    => " "
      n :when (< n 9)      => (+ "" n)
      _                    => "*"
    }))
  (console.log (glyph 3 false false))   ;; .   (arm 1 fires; not flagged)
  (console.log (glyph 0 false true))    ;; (a single space -- revealed 0)
  (console.log (glyph 5 false true))    ;; 5
  (console.log (glyph 2 true false))    ;; F   (arm 1 fires; flagged)
)

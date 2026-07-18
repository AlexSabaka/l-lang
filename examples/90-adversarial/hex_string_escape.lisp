;; ADVERSARIAL: `\xHH` hex escape in a string literal (finding PR3, l-lang-ex snake).
;;
;; `"\x1b[2J"` must decode `\x1b` to U+001B (ESC), not silently degrade to the bare
;; characters `x1b`. Degradation was the audit sighting; FIXED at HEAD. JSON.stringify
;; makes the exact code unit visible: a correct ESC prints as .
(
  (console.log (JSON.stringify "\x1b[2J"))
)

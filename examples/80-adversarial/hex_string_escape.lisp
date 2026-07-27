;; ADVERSARIAL: `\xHH` hex escape in a string literal (finding PR3, l-lang-ex snake).
;;
;; `"\x1b[2J"` must decode `\x1b` to U+001B (ESC), not silently degrade to the bare
;; characters `x1b`. Degradation was the audit sighting; FIXED at HEAD. JSON.stringify
;; makes the exact code unit visible: a correct ESC prints as .
;;
;; It renders through `std/text/json` rather than the host's `JSON.stringify`, which is why this file
;; runs on C at all: `JSON.stringify` is a JS host global on no floor, so the one file in the corpus
;; whose job is to prove an escape does not silently degrade was itself `LL0107`-refused on the
;; backend being kept. The golden is UNCHANGED by that swap -- it was recorded from the host, and an
;; l-lang renderer reproducing it byte for byte is the conformance evidence.
(
  (import "std/text/json")

  (console.log (to-json "\x1b[2J"))
)

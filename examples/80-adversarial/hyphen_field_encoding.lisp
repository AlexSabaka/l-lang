;; ADVERSARIAL (STILL BROKEN -- silent wrong answer): hyphenated map field encoding
;; (finding PR4, l-lang-ex snake). Kept as xfail: NO golden, because the current output
;; is wrong and a golden would bless the bug.
;;
;; A `:kw` map key stays literal (`next-dir`), but DOT access mangles the hyphen
;; (`.next-dir` -> `.next2ddir`), so the two spellings disagree on the same field:
;;   - `w.next-dir` reads a key that was never written          -> undefined
;;   - `(w.next-dir := "down")` writes a SECOND, mangled key    -> map grows a `next2ddir`
;;   - `(w["next-dir"])` bracket-reads the real key             -> "up"
;; EXPECTED (all three agree on one field): read "up", write, then all reads see "down",
;; and JSON shows a single `next-dir` key.
;; ACTUAL at HEAD:
;;   read-only half: undefined
;;   after write: down
;;   bracket: up
;;   whole map: {"next-dir":"up","next2ddir":"down"}
(
  (mut w {:next-dir "up"})
  (console.log "read-only half:" w.next-dir)
  (w.next-dir := "down")
  (console.log "after write:" w.next-dir)
  (console.log "bracket:" (w["next-dir"]))
  (console.log "whole map:" (JSON.stringify w))
)

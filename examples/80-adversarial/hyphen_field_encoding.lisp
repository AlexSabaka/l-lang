;; ADVERSARIAL: hyphenated map field encoding (finding PR4, l-lang-ex snake).
;;
;; FIXED ON C, and pinned here against C's answer (D86). It was xfail with no golden while the JS
;; backend was the reference -- "current output is wrong and a golden would bless the bug". C is the
;; reference now, C is correct, and the golden is C's.
;;
;; It could not be pinned earlier for a second, purely mechanical reason: the file ended with
;; `JSON.stringify`, which is `ELL0107` on C. `std/text/json` (D77) replaced it, so C can run the file
;; at all -- and once it did, all three spellings already agreed.
;;
;; A `:kw` map key stays literal (`next-dir`), but DOT access mangles the hyphen
;; (`.next-dir` -> `.next2ddir`), so the two spellings disagree on the same field:
;;   - `w.next-dir` reads a key that was never written          -> undefined
;;   - `(w.next-dir := "down")` writes a SECOND, mangled key    -> map grows a `next2ddir`
;;   - `(w["next-dir"])` bracket-reads the real key             -> "up"
;; EXPECTED (all three agree on one field): read "up", write, then all reads see "down",
;; and JSON shows a single `next-dir` key.
;; JS, WHICH IS THE DIVERGENCE THIS FILE NOW RECORDS:
;;   read-only half: nil
;;   after write: down
;;   bracket: up
;;   whole map: {"next-dir":"up","next2ddir":"down"}
;; Three spellings of one field, three answers, and the map grew a second key. D66 freezes that
;; backend, so the file is `oracleDivergent` and is not graded there.
(
  (import "std/text/json")

  (mut w {:next-dir "up"})
  (console.log "read-only half:" w.next-dir)
  (w.next-dir := "down")
  (console.log "after write:" w.next-dir)
  (console.log "bracket:" (w["next-dir"]))
  (console.log "whole map:" (to-json w))
)

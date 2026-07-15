;; The receivers are annotated `<- String` (Phase T / Jb): with the type known, `(s.toUpperCase)` and
;; `s.length` resolve through the native-member table to a direct `s.toUpperCase()` / `s.length`, rather
;; than the untyped `__ll_member` fallback. (Methods with arguments -- `s.slice`, `s.split` -- already
;; emitted directly via the arg-bearing branch; the annotation closes the 0-arg methods and the field.)
(
  (fn strlen [s <- String] -> Int s.length)
  (fn substr [s <- String start <- Int end <- Int] -> String (s.slice start end))
  (fn upcase [s <- String] -> String (s.toUpperCase))
  (fn downcase [s <- String] -> String (s.toLowerCase))
  (fn trim [s <- String] -> String (s.trim))
  (fn split [s <- String sep <- String] -> String[] (s.split sep))
  (fn join [arr <- Any[] sep <- String] -> String (arr.join sep))
  (fn contains [s <- String sub <- String] -> Boolean (s.includes sub))
  (fn starts-with [s <- String prefix <- String] -> Boolean (s.startsWith prefix))
  (fn ends-with [s <- String suffix <- String] -> Boolean (s.endsWith suffix))

  (export strlen substr upcase downcase trim split join contains starts-with ends-with)
)
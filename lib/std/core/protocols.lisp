;; std/core/protocols -- the small universal protocols (D55/§10: "complete the set").
;;
;; l-lang already ships one-or-two-method interfaces as the house style -- Iterable/Iterator/Disposable,
;; Writer/Reader, Clock. This module adds the three that every language eventually needs, kept exactly as
;; small: a type OPTS IN by `:implements`ing one, and the stdlib's generic operations dispatch on it.
;;
;;   * Comparable<T> -- one method `compare-to` gives the whole order (< <= > >= via its sign).
;;   * Hashable      -- `hash` for content-addressed containers (the future std/collections consumer).
;;   * Formattable   -- `format` customizes how a value renders through `display` (interpolation, print,
;;                      console.log) -- wired into the floor display path, so a Formattable type prints
;;                      its own way EVERYWHERE, not only where someone remembered to call a formatter.
;;
;; The generics below (`compare`, `hash-of`) are protocol-aware with a total fallback, so they work on
;; primitives too -- `(compare 3 5)` is -1 without anyone implementing anything.
(
  ;; -- the protocols ---------------------------------------------------------------------------------
  (definterface Comparable<T>
    (fn compare-to [other <- T] -> Int))      ;; negative if self<other, 0 if equal, positive if self>other

  (definterface Hashable
    (fn hash [] -> Int))

  (definterface Formattable
    (fn format [] -> String))

  ;; -- generic compare: the one order sort/min/max route through ------------------------------------
  ;; Comparable when the receiver is; otherwise the natural order of a primitive (Int/Real/String/Char)
  ;; via `<`/`>`. Comparing two values that are neither Comparable nor ordered primitives is a caller
  ;; error (there is no order to give), and the runtime `<` says so.
  (fn compare [a <- Any b <- Any] -> Int (
    (if (a :of Comparable) :then (return (a.compare-to b)))
    (if (< a b) :then (return -1))
    (if (> a b) :then (return 1))
    (return 0)))

  ;; -- generic hash: Hashable when it is, else a content hash over the display string ---------------
  ;; djb2 (`h*33 ^ c`) over the codepoints of `(display x)`, in D51's wrapping int64 with D61's bit ops.
  ;; Portable by construction: `display` is ruled identical on both backends (D55) and the arithmetic
  ;; wraps identically (D51), so the hash is byte-for-byte the same. It is NOT cryptographic, and it is
  ;; NOT the final hash protocol (roadmap Tier-3 #4 -- a `Hashable`-derives story is a future design
  ;; round); it is a working default so the interface and its consumers are testable today.
  (fn hash-of [x <- Any] -> Int (
    (if (x :of Hashable) :then (return (x.hash)))
    (let cps (string-to-codepoints (display x)))
    (mut h 5381)
    (for :each c :from cps :then (h := (bxor (* h 33) c)))
    (return h)))

  (export Comparable Hashable Formattable compare hash-of)
)

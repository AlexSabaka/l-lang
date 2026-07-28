;; std/core/protocols -- the small universal protocols (D55/§10: "complete the set").
;;
;; l-lang already ships one-or-two-method interfaces as the house style -- Iterable/Iterator/Disposable,
;; Writer/Reader, Clock. This module adds the four that every language eventually needs, kept exactly as
;; small: a type OPTS IN by `:implements`ing one, and the stdlib's generic operations dispatch on it.
;;
;;   * Comparable<T> -- one method `compare-to` gives the whole order (< <= > >= via its sign).
;;   * Hashable      -- `hash` for content-addressed containers (the future std/collections consumer).
;;   * Formattable   -- `format` customizes how a value renders through `display` (interpolation, print,
;;                      console.log) -- wired into the floor display path, so a Formattable type prints
;;                      its own way EVERYWHERE, not only where someone remembered to call a formatter.
;;   * Ring<T>       -- `+` and `*`. D88 named it "the natural fourth protocol beside D63's"; D89 built
;;                      it, and it is what a MATRIX's cells must share.
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

  ;; The algebraic one, and the only protocol here whose members are OPERATORS rather than names.
  ;;
  ;; That difference is load-bearing. A primitive has no member list, so `Int` conformed to NOTHING
  ;; before D89 -- `[x <- Comparable]` refused `3` and so would `[x <- Ring]`, which is absurd for the
  ;; type a numeric protocol most exists to describe. The checker now answers an OPERATOR-named member
  ;; from its operator tables, so `Int`, `Real` and `Char` are Rings, `Rational` and `Complex` are Rings
  ;; through their declared overloads, and `String` is not (it has `+` and no `*`). A NAMED member is
  ;; untouched by that rule, which is why `Comparable` still refuses `3`.
  ;;
  ;; The rule is deliberately NOT "must be numeric": that would exclude `Rational` and `Complex`, which
  ;; are exactly the types D88 built. It is "closed under `+` and `*`", which is what a ring is.
  ;;
  ;; KNOWN LOOSENESS, measured: a bare `Ring` erases `T`, so a type whose `*` takes something OTHER than
  ;; itself still conforms -- `Vec2`'s `(fn :operator * [k <- Real] -> Vec2)` passes. Tightening it to a
  ;; genuine closed-under-`T` check needs bounded generics (Phase Bg), which are not built.
  (definterface Ring<T>
    (fn :operator + [other <- T] -> T)
    (fn :operator * [other <- T] -> T))

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

  (export Comparable Hashable Formattable Ring compare hash-of)
)

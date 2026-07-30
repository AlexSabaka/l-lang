(
  (import "std/core/types")

  ;; D20: this list is the module's PUBLIC SURFACE, and it is now enforced (LL0215).
  ;;
  ;; It used to omit `abs floor ceil round pow min max inc dec` -- every one of them defined right
  ;; below and reachable from anywhere anyway, because `(export ...)` was decorative. It also omitted
  ;; `Complex`, which `complex_math_test/main.lisp` constructs. Nine leaked names; the whole corpus
  ;; blast radius of D20 was this one list.
  ;; NINE NAMES LEFT THIS LIST (D109): `abs floor ceil round min max E PI TAU` are all defined by a
  ;; package SIBLING -- `elementary.lisp` and `constants.lisp` -- and a package injects its siblings
  ;; into every importer, so exporting them here made which definition a program got depend on module
  ;; ORDER. `min`/`max` genuinely disagreed: this file's were `Math.min`/`Math.max`, whose C arm does
  ;; not propagate NaN, so `(min NAN 5)` answered 5 on C and NaN on JS -- the D50 divergence
  ;; `elementary.lisp`'s own header says a module must not re-export.
  ;;
  ;; Nothing loses reachability. `(import "std/math")` still reaches all nine through the same sibling
  ;; injection that reaches `clamp`, `gcd`, `sign`, `hypot`, `PHI` and `mean` -- now resolving to the
  ;; one correct definition instead of whichever came first.
  ;;
  ;; `dec` goes with them for a different reason: zero call sites anywhere, and `inc` stays because it
  ;; has them.
  (export sqr sqrt sin cos tan log exp truncate pow inc)
  ;; NOT `Number`. It belongs to std/types now, and a module cannot re-export a symbol it does not
  ;; define -- `visitExport` refuses ("Cannot export undefined symbol"). Anyone who wants the type
  ;; imports std/types, which is where it is declared, once.
  ;;
  ;; NOT `Complex`/`Vector3` either, as of D57. This file used to define both -- a real/imag `Complex`
  ;; and an x/y/z `Vector3` carrying `(fn :operator ·)`, the U+00B7 head operator D57 bans (its JS
  ;; encoding `b7` collides with a hand-writable member). They were placeholders from before the tower
  ;; was modular. The real types now live in `std/math/complex` (`Complex`, re/im, the full field) and
  ;; `std/math/vector` (`Vec2`/`Vec3`/`Vec`, dot/cross/norm), and both are reachable through this same
  ;; `(import "std/math")` because they are package siblings. This file keeps only the everyday scalar
  ;; layer -- the `Math.*` wrappers and the three constants -- which is the umbrella most callers want.

  (fn sqr [x <- Number] -> Number
    (* x x)
  )

  (fn inc [n <- Number] -> Number (+ n 1))

  ;; -> Real, NOT -> Int (D51 amendment (b)). These map onto the integers as VALUES, but their
  ;; representation stays Real, and the distinction is load-bearing in two places:
  ;;
  ;;   * D51's own float->int tie-break rule says `-0.5 -> -0`, and `-0` is not an Int value. The
  ;;     rule only parses if the result is Real.
  ;;   * Under D49d (`Int / Int` IS integer division), `-> Int` silently changes what arithmetic
  ;;     MEANS downstream: the idiomatic round-to-2-places spelling
  ;;         (/ (round (* x 100)) 100)
  ;;     becomes integer division and returns 0 instead of 0.87. A silent wrong answer -- the exact
  ;;     class FLOOR.md exists to eliminate -- introduced by the stdlib's own signature.
  ;;
  ;; This also ends a disagreement nobody could see: `codegen/c/intrinsics.ts` has ALWAYS declared
  ;; `Math.floor : Real -> Real`, while this file said `-> Int`. Neither half could check the other,
  ;; because `Math` is an untyped extern (lib/std/js/js.lisp), so the checker's return-check bails on
  ;; Unknown and never compares them. The C backend papered over it with an implicit narrowing cast.
  ;;
  ;; Narrowing is now NAMED at the site that wants it, via `truncate` below -- which is what D43
  ;; ("static types decide") asks for. The previous version of this comment argued the opposite and
  ;; cited `(fn random-int [...] -> Int (floor (rand min max)))`'s LL0213 as justification; that call
  ;; site is now `(truncate (rand ...))`, which says what it means.
  ;; The SOLE Real -> Int door (D51 amendment (b)). Truncates toward zero, agreeing with D49d's
  ;; `Int / Int` and with C's `int64_t` cast. A builtin conversion, so it does not collide with
  ;; D46/B-3's `(cast<T> x)`, which is the explicit-cast syntax for USER-DEFINED `defcast`s; when
  ;; Phase Cv lands, `(cast<Int> r)` routes through this rather than competing with it.
  (fn truncate [n <- Number] -> Int (Math.trunc n))


  (fn pow [base <- Number exp <- Number] -> Number (Math.pow base exp))
  
  (fn sqrt [x <- Number] -> Number
    (Math.sqrt x)
  )

  (fn sin [x <- Number] -> Number
    (Math.sin x)
  )

  (fn cos [x <- Number] -> Number
    (Math.cos x)
  )

  (fn tan [x <- Number] -> Number
    (Math.tan x)
  )

  (fn log [x <- Number] -> Number
    (Math.log x)
  )

  (fn exp [x <- Number] -> Number
    (Math.exp x)
  )

  ;; `(deftype Number Int | Real)` was DELETED here (Sf).
  ;;
  ;; It was defined TWICE -- here, and in std/types, WHICH THIS FILE IMPORTS. Both exported it, and
  ;; nothing said a word: two symbols with one name, and `resolveSymbol`'s flat cross-module fallback
  ;; picking whichever it happened to reach first. That is the duplicate-definition hole whose gate
  ;; (LL0218) is still pending, sitting live in the standard library.
  ;;
  ;; `Number` now comes from std/types, which is the single place it is defined.

  ;; Complex and Vector3 used to live here; they moved to std/math/complex and std/math/vector (D57).
  ;; See the export block above for why.
)
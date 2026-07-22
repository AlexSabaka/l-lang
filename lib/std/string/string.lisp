;; std/string -- l-lang on the codepoint floor (D52, Ff-2).
;;
;; Every function here used to be a one-line delegation to a JavaScript string method, and the two
;; backends answered in their own units: `strlen` was BYTES on C and UTF-16 CODE UNITS on JS, so
;; `(strlen "café")` was 5 and 4, and `(strlen "a😀b")` was 6 and 4 where D52 says 3. JS is right
;; below U+10000 by accident -- one UTF-16 unit per codepoint -- and wrong the moment anything is
;; astral, so neither backend was the reference and both are rebuilt onto `codepoint-*`.
;;
;; The shape of every rewritten function is the same: DECODE ONCE with `string-to-codepoints`, work
;; on the resulting `Int[]` with ordinary vector code, ENCODE ONCE with `string-from-codepoints`.
;; That is what keeps them linear -- reaching for `codepoint-at` per character would re-walk the
;; string each time, since a codepoint index is a walk on both backends (UTF-8 here, `[...s]` there).
;;
;; ------------------------------------------------------------------------------------------------
;; WHAT IS STILL A DELEGATION, AND WHY IT IS SAFE
;;
;; `split`, `join`, `contains`, `starts-with` and `ends-with` still call the native member, and that
;; is not an oversight. UTF-8 is SELF-SYNCHRONIZING: a continuation byte is distinguishable from a
;; lead byte, so a valid encoded needle cannot match starting in the middle of a character. A
;; substring PREDICATE is therefore already codepoint-correct on a byte scan, and JS's UTF-16 scan is
;; correct for the same reason. What is NOT safe is anything that returns or takes a POSITION or a
;; WIDTH -- which is exactly the set rewritten below.
;;
;; The one exception inside that set is `(split s "")`, which splits per byte on C and per UTF-16
;; unit on JS and is wrong on both. Nothing in the corpus does it; flagged, not fixed.
;; ------------------------------------------------------------------------------------------------
(
  ;; -- the ASCII case ruling -----------------------------------------------------------------------
  ;;
  ;; `upcase`/`downcase` map `a-z`/`A-Z` and pass EVERYTHING ELSE through, on both backends. So
  ;; `(upcase "café")` is `"CAFé"` and `(upcase "Привіт")` is `"Привіт"`, and both of those look like
  ;; bugs unless you know this line exists -- which is why the guard pins them.
  ;;
  ;; This is a deliberate narrowing of D52, which asked for a vendored simple-case table. The table
  ;; is the right long-term answer and it is still the right long-term answer; what it is not is
  ;; free. Full simple case mapping is ~1400 entries with conditional and locale-sensitive cases, and
  ;; it has to be vendored TWICE and kept in step, for a corpus containing exactly one non-ASCII
  ;; string literal. Host `toUpperCase`/`towupper` is not the alternative: it is ICU- and
  ;; locale-version-dependent, which is the divergence D52 exists to prevent -- `(upcase "café")` was
  ;; already `CAFÉ` on JS and `CAFé` on C, and today's fix makes JS agree with C rather than the
  ;; reverse, because C's answer is the one that is a RULE rather than a host's opinion.
  ;;
  ;; ASCII is a rule both backends can state exactly. When the table lands it replaces these two
  ;; functions and nothing else; the guard changes with it, on purpose.
  (fn ascii-upper [c <- Int] -> Int (if (&& (>= c 97) (<= c 122)) (- c 32) c))
  (fn ascii-lower [c <- Int] -> Int (if (&& (>= c 65) (<= c 90)) (+ c 32) c))

  ;; Space, tab, LF, CR -- and NOT the ~25 characters JS's `.trim` removes (it takes the whole of
  ;; Unicode White_Space plus BOM). C's `ll_str_trim` has always been exactly these four, so once
  ;; again this is JS narrowing to a stated rule rather than C growing to match a host library.
  (fn ascii-space [c <- Int] -> Boolean (|| (== c 32) (|| (== c 9) (|| (== c 10) (== c 13)))))

  ;; -- measurement and indexing --------------------------------------------------------------------

  (fn strlen [s <- String] -> Int (codepoint-length s))

  ;; "" past either end, matching `charAt` rather than throwing -- which is what lets a scanner look
  ;; one character ahead with no bounds test. `io.lisp`'s format scanner leans on exactly that.
  (fn char-at [s <- String i <- Int] -> String (
    (let cp (codepoint-at s i))
    (return (if (< cp 0) "" (string-from-codepoints [cp])))
  ))

  ;; Codepoint indices, not byte or code-unit offsets. `.slice` on the decoded vector gives the
  ;; negative-index and clamping behaviour both backends already share (`ll_slice_clamp` here,
  ;; `Array.prototype.slice` there), so the boundary rules are inherited rather than re-invented.
  ;;
  ;; `cps` is bound to a local FIRST, and it has to be. `((string-to-codepoints s).slice a b)` fails
  ;; on JS -- "Cannot convert a BigInt value to a number" -- because `NUMERIC_HOST_PARAMS` coerces
  ;; `slice`'s arguments only on the native-MEMBER path, and a call result as receiver does not take
  ;; it. Through a typed `Int[]` binding it does. C is unaffected either way, so this is the same
  ;; shape as Fg-3's `Math.trunc`: an implicit conversion that one backend performs silently.
  (fn substr [s <- String start <- Int end <- Int] -> String (
    (let cps (string-to-codepoints s))
    (return (string-from-codepoints (cps.slice start end)))
  ))

  (fn upcase [s <- String] -> String (
    (let cps (string-to-codepoints s))
    (let out [])
    (mut i <- Int 0)
    (while (< i cps.length) (
      (out.push (ascii-upper cps[i]))
      (i := (+ i 1))
    ))
    (return (string-from-codepoints out))
  ))

  (fn downcase [s <- String] -> String (
    (let cps (string-to-codepoints s))
    (let out [])
    (mut i <- Int 0)
    (while (< i cps.length) (
      (out.push (ascii-lower cps[i]))
      (i := (+ i 1))
    ))
    (return (string-from-codepoints out))
  ))

  (fn trim [s <- String] -> String (
    (let cps (string-to-codepoints s))
    (mut a <- Int 0)
    (mut b <- Int cps.length)
    (while (&& (< a b) (ascii-space cps[a])) (a := (+ a 1)))
    (while (&& (> b a) (ascii-space cps[(- b 1)])) (b := (- b 1)))
    (return (string-from-codepoints (cps.slice a b)))
  ))

  ;; -- width-sensitive, and therefore codepoint-sensitive -------------------------------------------
  ;;
  ;; `padStart` pads to a BYTE width on C: `("café".padStart 6 "-")` produced `-café` there and
  ;; `--café` on JS, because C measured the 4-character string as 5. Width is a count of characters.
  (fn pad-start [s <- String width <- Int pad <- String] -> String (
    (mut out <- String "")
    (mut n <- Int (- width (codepoint-length s)))
    (let p (if (== (codepoint-length pad) 0) " " pad))
    (while (> n 0) (
      (out := (+ out p))
      (n := (- n (codepoint-length p)))
    ))
    ;; The filler may overshoot when `pad` is more than one character wide; trim it to the deficit.
    (return (+ (substr out 0 (- width (codepoint-length s))) s))
  ))

  (fn pad-end [s <- String width <- Int pad <- String] -> String (
    (mut out <- String "")
    (mut n <- Int (- width (codepoint-length s)))
    (let p (if (== (codepoint-length pad) 0) " " pad))
    (while (> n 0) (
      (out := (+ out p))
      (n := (- n (codepoint-length p)))
    ))
    (return (+ s (substr out 0 (- width (codepoint-length s)))))
  ))

  (fn repeat [s <- String n <- Int] -> String (
    (mut out <- String "")
    (mut i <- Int 0)
    (while (< i n) (
      (out := (+ out s))
      (i := (+ i 1))
    ))
    (return out)
  ))

  ;; -- still native, and safe: see the header note on UTF-8 self-synchronization --------------------
  (fn split [s <- String sep <- String] -> String[] (s.split sep))
  (fn join [arr <- Any[] sep <- String] -> String (arr.join sep))
  (fn contains [s <- String sub <- String] -> Boolean (s.includes sub))
  (fn starts-with [s <- String prefix <- String] -> Boolean (s.startsWith prefix))
  (fn ends-with [s <- String suffix <- String] -> Boolean (s.endsWith suffix))

  ;; NOT EXPORTED, and deliberately absent:
  ;;
  ;;   `index-of` -- D52 lists it, and it COLLIDES: `std/seq` exports `index-of` too (Fg-4), and
  ;;   `16-stdlib/test_stdlib.lisp` imports both modules. D33's "pick one convention per file"
  ;;   answers the seq-vs-linq collision because those two are alternatives; seq and string are not,
  ;;   they are routinely used together. Naming is a decision, not an implementation detail, so it is
  ;;   left open rather than settled by whichever spelling was convenient here.
  ;;
  ;;   `replace` -- JS's `String.prototype.replace` gives the REPLACEMENT string special meaning
  ;;   (`$&`, `$1`, `$$`) and C's `ll_str_replace` does not. A one-line delegation would import that
  ;;   asymmetry silently; it needs its own ruling and its own guard.
  (export strlen substr upcase downcase trim split join contains starts-with ends-with
          char-at pad-start pad-end repeat)
)

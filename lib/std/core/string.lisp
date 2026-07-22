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

  ;; -- `format-args`, moved here from `std/io` --------------------------------------------------
  ;;
  ;; It was private to `std/io` with exactly one caller (`print`), and it is not an I/O operation at
  ;; all: it takes a template and a vector and answers a String, touching nothing outside this
  ;; module's subject. `std/io` imports it now like anyone else, which is the honest direction --
  ;; formatting is string work that printing HAPPENS to use, not a part of printing.
  ;;
  ;; It also belongs beside the rest of the codepoint surface, since it is written on
  ;; `string-to-codepoints` / `string-from-codepoints` for the reasons the block below gives, and
  ;; those are this module's subject.
  ;; C# `string.Format` positional substitution -- FLOOR.md 3.6. One left-to-right scan:
  ;;
  ;;     "{{"            -> a literal {
  ;;     "}}"            -> a literal }
  ;;     "{" digits "}"  -> the argument at that 0-based index
  ;;     anything else   -> emitted verbatim
  ;;
  ;; EVERY occurrence of an index is substituted. The previous implementation looped over the ARGS
  ;; and called `str.replace` with a string needle -- which replaces only the FIRST match -- so
  ;; `(print "{0} {0}" "x")` printed `x {0}`. That was an artifact of JS's `replace`, never a
  ;; decision, and nothing could see it because no non-adversarial example repeats an index.
  ;;
  ;; A placeholder whose index has no argument THROWS, as C#'s FormatException does. The two
  ;; alternatives -- printing the raw `{1}` (the old behaviour) or substituting empty -- both emit
  ;; plausible-looking output for a broken format string, which is the silent-wrong class FLOOR.md
  ;; exists to eliminate.
  ;;
  ;; The substituted value renders with `display` (FLOOR.md 3.5/3.6), NOT with `+` concat: `+` is the
  ;; one to-string context, and using it here made `{0}` on a container print `4,5` while console.log
  ;; printed `[4 5]` -- the same value, two renderings, for no reason a reader could predict.
  ;;
  ;; ------------------------------------------------------------------------------------------------
  ;; THE SCAN RUNS ON CODEPOINTS, NOT ON CHARACTERS (Ff-4). It used to read `msg.length` and
  ;; `(msg.charAt i)`, and three separate things were wrong with that:
  ;;
  ;;   1. QUADRATIC, and newly so. Ff-3 made C's `.charAt` a codepoint WALK, so a scanner calling it
  ;;      twice per position went from O(n) to O(n^2) underneath -- for every `print` in the language.
  ;;      Measured at 4000 characters: 0.20s for 20 calls, against ~0 now. Corpus format strings are
  ;;      short so nothing was failing, which is exactly why it needed measuring rather than noticing.
  ;;   2. QUADRATIC AGAIN, on the output side: `(out := (+ out ch))` reallocates the whole accumulated
  ;;      string per character. That was flagged as debt here and is now simply gone -- the result is
  ;;      accumulated as an Int[] and encoded ONCE.
  ;;   3. NOT PORTABLE BY CONSTRUCTION. `.length`/`.charAt` are the one place the two backends still
  ;;      disagree (`80-adversarial/native_string_astral.lisp`: JS counts UTF-16 code units past
  ;;      U+FFFF). The old scanner survived that only by luck -- it appended the two surrogate halves
  ;;      consecutively, so they reconstituted. Library code above the floor should not be relying on
  ;;      luck about a known divergence, and on codepoints it does not have to.
  ;;
  ;; Digits are arithmetic on the codepoint now (`c - 48`, range-checked), which retired the `DIGITS`
  ;; table this module used to carry. That table's OTHER job -- being a dotted-head read of an
  ;; imported module's own constant, the C path `ensureImportedValue` -- is held by
  ;; `80-adversarial/imported_module_constant.lisp`, which is a deliberate guard and says so.
  ;;
  ;; `-1` is the past-the-end sentinel for the one-character lookahead, replacing the `""` that
  ;; `charAt` returned. Same affordance, and the same ruling as `codepoint-at`: a codepoint is
  ;; non-negative, so -1 is out of band rather than a value that could be confused with one.
  ;; ------------------------------------------------------------------------------------------------
  (fn format-args [msg <- String args <- Any[]] -> String (
    (let cs (string-to-codepoints msg))
    (let n cs.length)
    (let out [])
    (mut i <- Int 0)
    (while (< i n) (
      (let ch cs[i])
      (let nx (if (< (+ i 1) n) cs[(+ i 1)] -1))
      (cond
        ;; 123 is `{`, 125 is `}`, 48..57 are `0`..`9`.
        ((&& (== ch 123) (== nx 123)) (
          (out.push 123)
          (i := (+ i 2))
        ))
        ((&& (== ch 125) (== nx 125)) (
          (out.push 125)
          (i := (+ i 2))
        ))
        ((== ch 123) (
          (mut j <- Int (+ i 1))
          (mut idx <- Int 0)
          (mut seen <- Int 0)
          ;; `(elem cs j)` and not `cs[j]`, for two reasons that happen to agree.
          ;;
          ;; The principled one: in a loop CONDITION you want the total accessor. `cs[j]` is partial
          ;; (D9) and throws past the end; `elem` answers nil, so the peek does not depend on the
          ;; `(< j n)` guard short-circuiting first.
          ;;
          ;; The forced one: a JS BACKEND BUG. An `if` in a `while` BODY fails to lower to HIR when
          ;; the while CONDITION contains an index expression, and falls through to the legacy
          ;; visitor -- "ELL0100 ... visitIf is not implemented in the JS backend", which is fatal, so
          ;; no JavaScript is emitted at all. Minimal repro: `(while (&& (< j n) (!= cs[j] 125))
          ;; ((let d (- cs[j] 48)) (if (< d 0) (throw (Error "bad")))))`. Remove the `if`, or the
          ;; index from the condition, or spell the index `(elem cs j)`, and it compiles. C is
          ;; unaffected. Flagged, not fixed -- it is a backend defect, not an `std/io` one.
          (while (&& (< j n) (!= (elem cs j) 125)) (
            (let d (- cs[j] 48))
            (if (|| (< d 0) (> d 9))
              (throw (Error "format: a placeholder index must be digits")))
            (idx := (+ (* idx 10) d))
            (seen := (+ seen 1))
            (j := (+ j 1))
          ))
          (if (>= j n)
            (throw (Error "format: unterminated placeholder, no closing brace")))
          (if (== seen 0)
            (throw (Error "format: empty placeholder, an index is required")))
          (if (>= idx args.length)
            (throw (Error "format: placeholder index has no argument")))
          (let rendered (string-to-codepoints (display args[idx])))
          (mut k <- Int 0)
          (while (< k rendered.length) (
            (out.push rendered[k])
            (k := (+ k 1))
          ))
          (i := (+ j 1))
        ))
        (true (
          (out.push ch)
          (i := (+ i 1))
        ))
      )
    ))
    (return (string-from-codepoints out))
  ))

  (export strlen substr upcase downcase trim split join contains starts-with ends-with
          char-at pad-start pad-end repeat format-args)
)

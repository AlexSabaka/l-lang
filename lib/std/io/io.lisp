(
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

  (fn print [msg <- String ...args <- Any[]] -> Void
    (console.log (format-args msg args)))

  (fn prn [x] (console.log x))
  
  ;; The guard compares `typeof window` to the STRING "undefined", and must.
  ;;
  ;; It used to read `(&& (typeof window) (!= window nil))`. Two problems, and either one is fatal
  ;; outside a browser: `typeof window` yields the string "undefined", which is TRUTHY, so the `&&`
  ;; always proceeded -- and `(!= window nil)` then TOUCHES an undeclared `window`, which is a
  ;; ReferenceError, not a false. `typeof` is the only operator that may name a binding that does not
  ;; exist; that is the entire reason to reach for it here.
  (fn alert [msg]
    (if (!= (typeof window) "undefined")
      (window.alert msg)
      (console.log "ALERT:" msg)))

  (export print prn alert)
)
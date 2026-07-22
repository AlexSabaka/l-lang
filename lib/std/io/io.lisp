(
  ;; The digit table. `indexOf` returns -1 for a non-digit, so validating a character and converting
  ;; it to its value are the SAME lookup -- the trick 20-algorithms/07_tokenizer.lisp uses, and it
  ;; avoids `parseInt` (an untyped extern that would infer Unknown).
  ;;
  ;; Module-level, and that is load-bearing as a test: reading it from `format-args` is a dotted-head
  ;; read of an imported module's own constant, which the C backend hoists via `ensureImportedValue`.
  ;; That path was broken until 8f1f0a0's follow-up; `80-adversarial/imported_module_constant.lisp`
  ;; is the deliberate guard, so this file is not the only thing holding the coverage.
  (let DIGITS "0123456789")

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
  ;; `.charAt`, not `s[i]`: it yields "" past the end on BOTH backends (JS's charAt, and runtime.c's
  ;; `ll_str_char_at`), so the one-character lookahead needs no bounds guard. `s[i]` would raise a
  ;; RangeError on JS.
  ;;
  ;; The substituted value renders with `display` (FLOOR.md 3.5/3.6), NOT with `+` concat: `+` is the
  ;; one to-string context, and using it here made `{0}` on a container print `4,5` while console.log
  ;; printed `[4 5]` -- the same value, two renderings, for no reason a reader could predict.
  ;;
  ;; DEBT: O(n^2) on immutable concat. Fine at `print` sizes; worth revisiting if a caller ever
  ;; formats in a loop.
  (fn format-args [msg <- String args <- Any[]] -> String (
    (mut out <- String "")
    (mut i <- Int 0)
    (let n msg.length)
    (while (< i n) (
      (let ch (msg.charAt i))
      (let nx (msg.charAt (+ i 1)))
      (cond
        ((&& (== ch "{") (== nx "{")) (
          (out := (+ out "{"))
          (i := (+ i 2))
        ))
        ((&& (== ch "}") (== nx "}")) (
          (out := (+ out "}"))
          (i := (+ i 2))
        ))
        ((== ch "{") (
          (mut j <- Int (+ i 1))
          (mut idx <- Int 0)
          (mut seen <- Int 0)
          (while (&& (< j n) (!= (msg.charAt j) "}")) (
            (let d (DIGITS.indexOf (msg.charAt j)))
            (if (< d 0)
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
          (out := (+ out (display args[idx])))
          (i := (+ j 1))
        ))
        (true (
          (out := (+ out ch))
          (i := (+ i 1))
        ))
      )
    ))
    (return out)
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
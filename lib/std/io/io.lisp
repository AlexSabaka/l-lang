(
  ;; The digit table. `indexOf` returns -1 for a non-digit, so validating a character and converting
  ;; it to its value are the SAME lookup -- the trick 20-algorithms/07_tokenizer.lisp already uses,
  ;; and which avoids `parseInt` (an untyped extern that would infer Unknown).
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
  ;; DEBT (Fc): the substituted value goes through `+`, i.e. `to-string`, so a container renders
  ;; `a,b` here while `console.log` renders `[ 'a', 'b' ]`. FLOOR.md 3.5 rules that `{N}` should use
  ;; `display`; that unification lands with Fc, when `display` exists as something callable. Also
  ;; O(n^2) on immutable concat -- fine at `print` sizes, worth revisiting if it ever grows a caller
  ;; that formats in a loop.
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
          (out := (+ out args[idx]))
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
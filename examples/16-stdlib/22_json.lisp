;; std/text/json -- JSON, written in l-lang.
;;
;; `JSON.stringify` was the last JS host global still leaking past the floor, so every program using
;; it was `LL0107` on C -- including the two adversarial files whose job is to notice a silent backend
;; divergence. The engine is l-lang rather than a binding, for D67's reason: one source compiles to
;; every backend, so there is no dialect to diverge on.
;;
;; The escape table and the compact form were not chosen here. They are pinned by
;; `80-adversarial/hex_string_escape.expect` and `spread_in_literals.expect`, both recorded from the
;; host's `JSON.stringify` before this module existed and both unchanged by it landing.
(
    (import "std/text/json")

    ;; -- the seven JSON value kinds ----------------------------------------------------------------

    (console.log (to-json nil))
    (console.log (to-json #t) (to-json #f))
    (console.log (to-json 42) (to-json -7))
    (console.log (to-json "text"))
    (console.log (to-json [1 2 3]))
    (console.log (to-json {:a 1 :b "two"}))

    ;; -- numbers -----------------------------------------------------------------------------------
    ;;
    ;; JSON has ONE number type, so the Int/Real distinction l-lang draws is not expressible in the
    ;; output: a Real that happens to be whole renders without a fractional part, exactly as the host
    ;; does. Reading it back therefore answers an Int, and that asymmetry belongs to the format.

    (console.log "reals:" (to-json [1.5 2.0 -0.25]))

    ;; -- escaping ----------------------------------------------------------------------------------
    ;;
    ;; Seven named escapes; every other control character below U+0020 takes `\u00XX`, four digits,
    ;; LOWERCASE hex. Non-ASCII is not escaped -- a String is a sequence of scalar values (D52), so
    ;; there are no lone surrogates to hide.

    (console.log (to-json "quote\" slash\\ tab\t"))
    (console.log (to-json "\x1b[2J"))
    (console.log (to-json "héllo wörld"))

    ;; `/` is legal to escape and the host does not, so neither does this.
    (console.log (to-json "a/b"))

    ;; -- nesting and the empty containers ----------------------------------------------------------

    (console.log (to-json {:xs [1 [2 3]] :m {:k nil}}))
    (console.log (to-json []) (to-json {}))

    ;; -- NIL INSIDE A CONTAINER --------------------------------------------------------------------
    ;;
    ;; The row that found a real backend divergence, so it is not incidental coverage.
    ;;
    ;; `write-array` walks by INDEX rather than with `for :each`. On C a `for :each` over a BOXED
    ;; container goes through the floor's iteration protocol, where `next` answering nil means
    ;; EXHAUSTED -- so a nil ELEMENT ends the walk and `[1 nil 2]` rendered as `[1]` here while JS
    ;; printed `[1,null,2]`. JSON is the worst place to inherit that: `null` is one of its value kinds,
    ;; so losing it corrupts a document rather than truncating it visibly.
    ;;
    ;; `80-adversarial/boxed_nil_iteration.lisp` pins the underlying defect on its own.

    (console.log "nil in array:" (to-json [1 nil 2]))

    ;; -- pretty ------------------------------------------------------------------------------------
    ;;
    ;; Byte-identical to `JSON.stringify(v, null, 2)`: two spaces per level, a space after the colon,
    ;; and an empty container stays on one line rather than becoming `[\n\n]`.

    (console.log (to-json-pretty {:a [1 {:b 2}] :c []} 2))

    ;; -- parsing -----------------------------------------------------------------------------------

    (let v (parse-json "{\"name\":\"Ada\",\"tags\":[1,2.5,true,null]}"))
    (console.log "round trip:" (to-json v))

    ;; Whitespace between any two tokens.
    (console.log "spaced:" (to-json (parse-json "  [ 1 ,  2 ]  ")))

    ;; Escapes decode on the way in, including `\u`.
    (console.log "unescaped:" (to-json (parse-json "\"a\\u001bb\\tc\"")))

    ;; EXACT PAST 2^53, which is the single most common JSON data-loss bug. A parser that routes every
    ;; number through a double answers 9007199254740992 for this -- one less than the input, silently.
    ;; Ints go through `try-parse-int`, which detects overflow rather than suffering it.
    (console.log "big int:" (parse-json "9007199254740993"))

    ;; The exponent forms are Reals, by the language's own rule (D71): a `.`, `e` or `E` makes it one.
    (console.log "exponent:" (parse-json "-1.5e2"))

    ;; -- the two conventions -----------------------------------------------------------------------
    ;;
    ;; `parse-json` throws, `try-parse-json` answers nil -- the split `std/core/string` already uses
    ;; for `parse-int`/`try-parse-int`. Never a third.

    (console.log "malformed:" (try-parse-json "{oops}"))

    ;; TRAILING CONTENT IS NOT A DOCUMENT. Accepting the prefix silently is how a truncated response
    ;; gets mistaken for a complete one.
    (console.log "trailing:" (try-parse-json "{\"a\":1} and more"))

    (try
        (parse-json "[1,")
     catch e (console.log "throws:" (e.message)))
)

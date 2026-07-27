;; std/text/json -- JSON, written in l-lang.
;;
;; `JSON.stringify` was the last JavaScript host global still leaking past the floor (D50). It had no
;; native counterpart, so every program that used it was `LL0107: resolves to a JavaScript host global`
;; on C -- which is to say the two adversarial files that pin SPREAD and the `\xHH` escape, the ones
;; whose whole job is to notice a silent backend divergence, could not run on the backend being kept.
;;
;; THE ENGINE IS l-lang, NOT A BINDING, for the same reason D67 gave for the regex engine: one source
;; compiles to every backend, so there is no dialect to diverge on. Binding a C JSON library on one
;; side while JS kept `JSON.stringify` on the other would have reproduced exactly the class of silent
;; split D66 deprecated the JS backend to stop -- and JSON is full of places two implementations
;; quietly disagree (which control characters get named escapes, whether non-ASCII is escaped, whether
;; `1.0` renders as `1` or `1.0`).
;;
;; ------------------------------------------------------------------------------------------------
;; THE ESCAPE TABLE IS PINNED BY AN EXISTING GOLDEN, not chosen.
;;
;; `80-adversarial/hex_string_escape.expect` was recorded from the host's `JSON.stringify` and reads
;; `"[2J"` -- so U+001B renders as ``: LOWERCASE hex, four digits, and NOT one of the
;; named escapes. `spread_in_literals.expect` reads `[0,1,2,3]` -- so arrays are COMPACT, no space
;; after the comma. Both files keep their goldens unchanged across this module landing, which is the
;; strongest check available: an l-lang implementation that reproduces a host's output byte for byte
;; on two files it never saw is a conformance test, not a blessing.
;;
;; The named escapes are the seven JSON has (`\" \\ \b \f \n \r \t`); every other control character
;; below U+0020 takes `\u00XX`. Non-ASCII is NOT escaped -- `"héllo"` stays `"héllo"` -- which is what
;; `JSON.stringify` does and what D52 wants, since a String here is a sequence of scalar values and
;; there are no lone surrogates to worry about.
;;
;; `/` is not escaped. It is legal to escape it and the host does not, so neither does this.
;;
;; ------------------------------------------------------------------------------------------------
;; NUMBERS. Int and Real both render through string concatenation, which is `display`'s renderer and
;; is ruled identical on both backends (D55). That makes `1.0` render as `1` -- measured, on both --
;; matching the host, because JSON has ONE number type and the distinction l-lang draws is not
;; expressible in the output. Reading it back therefore answers an Int, and that asymmetry is the
;; format's, not this module's.
;;
;; On the way IN the rule is the language's own (D71): a token containing `.`, `e` or `E` is a Real,
;; and anything else is an Int. An Int goes through `try-parse-int`, which is exact and
;; overflow-checked past 2^53 -- so a JSON document carrying a 64-bit id round-trips instead of
;; silently becoming a nearby double, which is the single most common JSON data-loss bug.
;;
;; ------------------------------------------------------------------------------------------------
;; WHAT IS NOT JSON DATA IS REFUSED, LOUDLY. A class instance, a function or a cursor has no JSON
;; rendering, and the two available alternatives are both worse than throwing: emitting `null` loses
;; the field silently, and emitting `{}` claims an empty object that never existed. Converting a value
;; to a map is the caller's job -- a `Jsonable` protocol would be a design round, not a default.
;;
;; TWO CONVENTIONS, NEVER THREE: `parse-json` throws and `try-parse-json` answers nil, the same split
;; `std/core/string` already uses for `parse-int`/`try-parse-int`.
(
    (import "std/core/types")
    (import "std/core/errors")
    (import "std/core/string")
    (import "std/core/builder")

    ;; ==============================================================================================
    ;; RENDERING
    ;; ==============================================================================================

    ;; One lowercase hex digit. `48` is '0', `87 + 10` is 'a'.
    (fn hex-digit [n <- Int] -> String (
        (if (< n 10)
            (return (string-from-codepoints [(+ 48 n)]))
            (return (string-from-codepoints [(+ 87 n)])))
    ))

    ;; `\u00XX` for a control character. Four digits always -- `\u1b` is not JSON.
    (fn unicode-escape [c <- Int] -> String (
        (let sb (StringBuilder))
        (sb.append "\\u")
        (sb.append (hex-digit (band (shr c 12) 15)))
        (sb.append (hex-digit (band (shr c 8) 15)))
        (sb.append (hex-digit (band (shr c 4) 15)))
        (sb.append (hex-digit (band c 15)))
        (return (sb.to-string))
    ))

    ;; A JSON string literal, quotes included.
    (fn escape-string [s <- String] -> String (
        (let sb (StringBuilder))
        (sb.append "\"")
        (for :each c :from (string-to-codepoints s) :then (
            (cond
                ((== c 34) (sb.append "\\\""))
                ((== c 92) (sb.append "\\\\"))
                ((== c 8)  (sb.append "\\b"))
                ((== c 12) (sb.append "\\f"))
                ((== c 10) (sb.append "\\n"))
                ((== c 13) (sb.append "\\r"))
                ((== c 9)  (sb.append "\\t"))
                ((< c 32)  (sb.append (unicode-escape c)))
                (:else     (sb.append (string-from-codepoints [c])))
            )
        ))
        (sb.append "\"")
        (return (sb.to-string))
    ))

    ;; The renderer. Mutually recursive with the two container writers below.
    ;;
    ;; `indent` < 0 means COMPACT -- no whitespace anywhere, which is the form the two adversarial
    ;; goldens pin. `indent` >= 0 is the pretty form and `depth` is the current nesting level.
    (fn write-value [sb <- StringBuilder v <- Any indent <- Int depth <- Int] -> Void (
        (cond
            ((is-nil v)    (sb.append "null"))
            ((is-bool v)   (if v (sb.append "true") (sb.append "false")))
            ((is-number v) (sb.append (+ "" v)))
            ((is-string v) (sb.append (escape-string v)))
            ((is-array v)  (write-array sb v indent depth))
            ((is-map v)    (write-map sb v indent depth))
            (:else (throw (ValueError (+ (+ "to-json: a " (type-name v))
                                         " is not JSON data -- convert it to a map first"))))
        )
    ))

    ;; A newline plus `depth` levels of indent, or nothing at all in compact mode.
    (fn write-break [sb <- StringBuilder indent <- Int depth <- Int] -> Void (
        (when (>= indent 0) :then (
            (sb.append "\n")
            (sb.append-repeat " " (* indent depth))
        ))
    ))

    ;; `xs` arrives BOXED -- the parameter is `Any`, because the value came out of a JSON document and
    ;; its element type is not knowable.
    ;;
    ;; THIS WAS AN INDEX WALK, and the reason is worth keeping even though the reason is gone: a
    ;; `for :each` over a boxed container used to stop at the first nil ELEMENT on C, because the
    ;; iteration protocol spelled "exhausted" as nil. `[1 nil 2]` rendered `[1,null,2]` on JS and `[1]`
    ;; here, silently -- and JSON is the worst place to inherit that, since `null` is one of its value
    ;; kinds, so losing one corrupts a document rather than truncating it visibly.
    ;;
    ;; The cursor now carries a `done` FLAG, so a nil element is just an element and this is an
    ;; ordinary loop again. The guard is `80-adversarial/boxed_nil_iteration.lisp` plus the
    ;; `nil in array:` row of this module's own golden, which did not move across the revert.
    (fn write-array [sb <- StringBuilder xs <- Any indent <- Int depth <- Int] -> Void (
        ;; An EMPTY container renders as `[]` on one line even when pretty-printing. `[\n\n]` is what
        ;; the general path would produce and no formatter emits it.
        (if (== xs.length 0) (sb.append "[]") (
            (sb.append "[")
            (mut first <- Boolean #t)
            (for :each x :from xs :then (
                (if (not first) (sb.append ","))
                (first := #f)
                (write-break sb indent (+ depth 1))
                (write-value sb x indent (+ depth 1))
            ))
            (write-break sb indent depth)
            (sb.append "]")
        ))
    ))

    (fn write-map [sb <- StringBuilder m <- Any indent <- Int depth <- Int] -> Void (
        (let ks (map-keys m))
        (if (== ks.length 0) (sb.append "{}") (
            (sb.append "{")
            (mut first <- Boolean #t)
            (for :each k :from ks :then (
                (if (not first) (sb.append ","))
                (first := #f)
                (write-break sb indent (+ depth 1))
                (sb.append (escape-string k))
                (sb.append ":")
                (when (>= indent 0) :then (sb.append " "))
                (write-value sb (map-get m k) indent (+ depth 1))
            ))
            (write-break sb indent depth)
            (sb.append "}")
        ))
    ))

    ;; Compact JSON -- no whitespace. The form both adversarial goldens pin.
    (fn to-json [v <- Any] -> String (
        (let sb (StringBuilder))
        (write-value sb v -1 0)
        (return (sb.to-string))
    ))

    ;; Indented JSON, `indent` spaces per level.
    (fn to-json-pretty [v <- Any indent <- Int] -> String (
        (let sb (StringBuilder))
        (write-value sb v (if (< indent 0) 0 indent) 0)
        (return (sb.to-string))
    ))

    ;; ==============================================================================================
    ;; PARSING
    ;; ==============================================================================================

    ;; A cursor over the document's CODEPOINTS (D52). Decoded once -- reading through `codepoint-at`
    ;; instead would re-walk the string per character, which is O(n^2) on a representation that is a
    ;; walk on both backends. The same reason `std/core/string` is written this way.
    (defclass JsonParser
        (let :ctor cps <- Int[])
        (mut pos <- Int 0)

        (fn at-end [] -> Boolean (return (>= this.pos this.cps.length)))

        ;; -1 past the end, out of band rather than an in-band lie (D9) -- a codepoint is
        ;; non-negative by definition, so lookahead needs no bounds check at every call site.
        (fn peek [] -> Int (
            (if (this.at-end) (return -1))
            (return this.cps[this.pos])
        ))

        (fn advance [] -> Int (
            (let c (this.peek))
            (this.pos := (+ this.pos 1))
            (return c)
        ))

        ;; The four JSON whitespace characters, and only those: space, tab, newline, carriage return.
        (fn skip-ws [] -> Void (
            (mut going <- Boolean #t)
            (while going (
                (let c (this.peek))
                (if (or (== c 32) (or (== c 9) (or (== c 10) (== c 13))))
                    (this.pos := (+ this.pos 1))
                    (going := #f))
            ))
        ))

        (fn fail [msg <- String] -> Void (
            (throw (ValueError (+ (+ "parse-json: " msg) (+ " at offset " (+ "" this.pos)))))
        ))

        ;; Consume an expected character or fail naming it.
        (fn expect [c <- Int what <- String] -> Void (
            (if (!= (this.peek) c) (this.fail (+ "expected " what)))
            (this.pos := (+ this.pos 1))
        ))

        ;; Consume a bare word (`true`/`false`/`null`) and answer whether it was there.
        (fn word [w <- String] -> Boolean (
            (let wc (string-to-codepoints w))
            (if (> (+ this.pos wc.length) this.cps.length) (return #f))
            (mut i <- Int 0)
            (while (< i wc.length) (
                (if (!= this.cps[(+ this.pos i)] wc[i]) (return #f))
                (i := (+ i 1))
            ))
            (this.pos := (+ this.pos wc.length))
            (return #t)
        ))

        (fn parse-value [] -> Any (
            (this.skip-ws)
            (let c (this.peek))
            (cond
                ((== c 123) (return (this.parse-object)))     ;; {
                ((== c 91)  (return (this.parse-array)))      ;; [
                ((== c 34)  (return (this.parse-string)))     ;; "
                ((== c 116) (
                    (if (this.word "true") (return #t))
                    (this.fail "expected 'true'")
                    (return nil)
                ))
                ((== c 102) (
                    (if (this.word "false") (return #f))
                    (this.fail "expected 'false'")
                    (return nil)
                ))
                ((== c 110) (
                    (if (this.word "null") (return nil))
                    (this.fail "expected 'null'")
                    (return nil)
                ))
                ((== c -1) ((this.fail "unexpected end of input") (return nil)))
                (:else (return (this.parse-number)))
            )
        ))

        (fn parse-array [] -> Any (
            (this.expect 91 "'['")
            (mut out <- Any[] [])
            (this.skip-ws)
            (if (== (this.peek) 93) ((this.pos := (+ this.pos 1)) (return out)))
            (mut going <- Boolean #t)
            (while going (
                (out.push (this.parse-value))
                (this.skip-ws)
                (let c (this.peek))
                (cond
                    ((== c 44) (this.pos := (+ this.pos 1)))     ;; ,
                    ((== c 93) ((this.pos := (+ this.pos 1)) (going := #f)))
                    (:else ((this.fail "expected ',' or ']'") (going := #f)))
                )
            ))
            (return out)
        ))

        (fn parse-object [] -> Any (
            (this.expect 123 "'{'")
            (let out {})
            (this.skip-ws)
            (if (== (this.peek) 125) ((this.pos := (+ this.pos 1)) (return out)))
            (mut going <- Boolean #t)
            (while going (
                (this.skip-ws)
                (let k (this.parse-string))
                (this.skip-ws)
                (this.expect 58 "':'")
                (map-set out k (this.parse-value))
                (this.skip-ws)
                (let c (this.peek))
                (cond
                    ((== c 44) (this.pos := (+ this.pos 1)))
                    ((== c 125) ((this.pos := (+ this.pos 1)) (going := #f)))
                    (:else ((this.fail "expected ',' or '}'") (going := #f)))
                )
            ))
            (return out)
        ))

        ;; Four hex digits after `\u`. Answers -1 on a bad digit so the caller reports the position.
        (fn hex4 [] -> Int (
            (mut v <- Int 0)
            (mut i <- Int 0)
            (while (< i 4) (
                (let c (this.advance))
                (mut d <- Int -1)
                (cond
                    ((and (>= c 48) (<= c 57))  (d := (- c 48)))
                    ((and (>= c 97) (<= c 102)) (d := (- c 87)))
                    ((and (>= c 65) (<= c 70))  (d := (- c 55)))
                    (:else (return -1))
                )
                (v := (+ (* v 16) d))
                (i := (+ i 1))
            ))
            (return v)
        ))

        (fn parse-string [] -> String (
            (this.expect 34 "'\"'")
            (let sb (StringBuilder))
            (mut going <- Boolean #t)
            (while going (
                (let c (this.advance))
                (cond
                    ((== c -1) ((this.fail "unterminated string") (going := #f)))
                    ((== c 34) (going := #f))
                    ((== c 92) (
                        (let e (this.advance))
                        (cond
                            ((== e 34)  (sb.append "\""))
                            ((== e 92)  (sb.append "\\"))
                            ((== e 47)  (sb.append "/"))
                            ((== e 98)  (sb.append (string-from-codepoints [8])))
                            ((== e 102) (sb.append (string-from-codepoints [12])))
                            ((== e 110) (sb.append (string-from-codepoints [10])))
                            ((== e 114) (sb.append (string-from-codepoints [13])))
                            ((== e 116) (sb.append (string-from-codepoints [9])))
                            ((== e 117) (
                                (let h (this.hex4))
                                (if (< h 0) (this.fail "bad \\u escape"))
                                (sb.append (string-from-codepoints [h]))
                            ))
                            (:else (this.fail "unknown escape"))
                        )
                    ))
                    (:else (sb.append (string-from-codepoints [c])))
                )
            ))
            (return (sb.to-string))
        ))

        ;; A number token, then D71's rule: a `.`, `e` or `E` makes it a Real, otherwise an Int.
        (fn parse-number [] -> Any (
            (let start this.pos)
            (mut real <- Boolean #f)
            (if (== (this.peek) 45) (this.pos := (+ this.pos 1)))    ;; leading '-'
            (mut going <- Boolean #t)
            (while going (
                (let c (this.peek))
                (cond
                    ((and (>= c 48) (<= c 57)) (this.pos := (+ this.pos 1)))
                    ((== c 46)  ((real := #t) (this.pos := (+ this.pos 1))))
                    ((== c 101) ((real := #t) (this.pos := (+ this.pos 1))))   ;; e
                    ((== c 69)  ((real := #t) (this.pos := (+ this.pos 1))))   ;; E
                    ((== c 43)  (this.pos := (+ this.pos 1)))                  ;; + in an exponent
                    ((== c 45)  (this.pos := (+ this.pos 1)))                  ;; - in an exponent
                    (:else (going := #f))
                )
            ))
            (if (== this.pos start) ((this.fail "expected a value") (return nil)))
            (mut token <- Int[] [])
            (mut i <- Int start)
            (while (< i this.pos) (
                (token.push this.cps[i])
                (i := (+ i 1))
            ))
            (let text (string-from-codepoints token))
            (if real (return (parseFloat text)))
            ;; EXACT past 2^53. `parseFloat` here would turn a 64-bit id into a nearby double, which
            ;; is the classic JSON data-loss bug; `try-parse-int` detects overflow instead of suffering
            ;; it, and a value that will not fit answers nil rather than a wrong number.
            (let n (try-parse-int text))
            (if (== n nil) ((this.fail (+ (+ "'" text) "' is not a valid number")) (return nil)))
            (return n)
        ))
    )

    ;; Parse a JSON document. Throws `ValueError` on anything malformed, including trailing content --
    ;; `{"a":1} oops` is not a document, and accepting the prefix silently is how a truncated response
    ;; gets mistaken for a complete one.
    (fn parse-json [s <- String] -> Any (
        (let p (JsonParser (string-to-codepoints s)))
        (let v (p.parse-value))
        (p.skip-ws)
        (if (not (p.at-end)) (p.fail "trailing content after the value"))
        (return v)
    ))

    ;; The total twin. Answers nil for a document that does not parse.
    (fn try-parse-json [s <- String] -> Any? (
        (try (return (parse-json s))
         catch (return nil))
    ))

    (export to-json to-json-pretty parse-json try-parse-json JsonParser)
)

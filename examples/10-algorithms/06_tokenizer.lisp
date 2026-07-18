;; A tokenizer for a tiny arithmetic language
;;
;; Reads a source string like "12 + 3 * (40 - 5)" and produces a token stream.
;; This example combines several features that are usually shown in isolation:
;; - `defenum` to name the token kinds, and `match` over those enum constants
;; - `match` with guards (`pattern :when expr`) to classify a character
;; - `cond` to dispatch the scanner on that classification
;; - `std/string` (strlen / substr / contains / join) for all character work
;; - `std/seq` (map / filter / reduce / length) to summarize the token stream
;; - a `while` loop with an explicit cursor, plus vectors and `.push`

(
    (import "std/string")
    (import "std/seq")

    ;; 1. The token kinds. An enum keeps the scanner and the printer honest:
    ;;    both talk about TokenKind:PLUS, never about the string "PLUS".
    (defenum TokenKind
        :NUMBER
        :PLUS
        :MINUS
        :STAR
        :LPAREN
        :RPAREN)

    (let DIGITS "0123456789")
    (let PUNCT "+-*()")

    ;; 2. Character classification with guarded match arms.
    ;;    Each arm binds `c`, then the `:when` guard decides whether it applies.
    ;;    Arms are tried top to bottom, so the first guard that holds wins.
    (fn char-class [ch <- String] -> String (
        (match ch {
            c :when (== c " ")          => "space"
            c :when (contains DIGITS c) => "digit"
            c :when (contains PUNCT c)  => "punct"
            _                           => "unknown"
        })
    ))

    ;; 3. Single-character punctuation -> TokenKind, by constant match.
    (fn punct-kind [ch <- String] (
        (match ch {
            "+" => TokenKind:PLUS
            "-" => TokenKind:MINUS
            "*" => TokenKind:STAR
            "(" => TokenKind:LPAREN
            ")" => TokenKind:RPAREN
            _   => nil
        })
    ))

    ;; 4. The reverse direction: match over the enum constants to get a
    ;;    printable name for the token stream dump.
    (fn kind-name [k] -> String (
        (match k {
            TokenKind:NUMBER => "NUMBER"
            TokenKind:PLUS   => "PLUS"
            TokenKind:MINUS  => "MINUS"
            TokenKind:STAR   => "STAR"
            TokenKind:LPAREN => "LPAREN"
            TokenKind:RPAREN => "RPAREN"
            _                => "UNKNOWN"
        })
    ))

    ;; 5. The scanner: one cursor, one pass, no backtracking.
    ;;    A token is a map of kind / source text / start position / value,
    ;;    where `value` is what the scanner accumulated while reading digits.
    ;;
    ;;    The `cond` below has one clause per character class:
    ;;      "space" -> advance, emit nothing
    ;;      "digit" -> eat the whole run of digits, emit one NUMBER
    ;;      "punct" -> emit exactly one operator or paren token
    ;;      else    -> emit an UNKNOWN token rather than silently dropping it
    (fn tokenize [src <- String] (
        (mut tokens [])
        (mut i 0)
        (while (< i (strlen src)) (
            (let ch (substr src i (+ i 1)))
            (let cls (char-class ch))
            (cond
                ((== cls "space")
                    (i := (+ i 1)))

                ((== cls "digit") (
                    (mut j i)
                    (mut value 0)
                    (while (&& (< j (strlen src)) (== (char-class (substr src j (+ j 1))) "digit")) (
                        (let d (substr src j (+ j 1)))
                        (value := (+ (* value 10) (DIGITS.indexOf d)))
                        (j := (+ j 1))
                    ))
                    (tokens.push { :kind TokenKind:NUMBER :text (substr src i j) :pos i :value value })
                    (i := j)
                ))

                ((== cls "punct") (
                    (tokens.push { :kind (punct-kind ch) :text ch :pos i :value 0 })
                    (i := (+ i 1))
                ))

                (true (
                    (tokens.push { :kind nil :text ch :pos i :value 0 })
                    (i := (+ i 1))
                ))
            )
        ))
        (return tokens)
    ))

    ;; 6. Rendering: one line per token, "pos <tab> KIND <tab> text".
    (fn render [t] -> String '"{(t.pos)}\t{(kind-name t.kind)}\t{(t.text)}")

    (let source "12 + 3 * (40 - 5)")
    (let tokens (tokenize source))

    (console.log '"source: {(source)}")
    (console.log "--- tokens ---")
    (console.log (join (map render tokens) "\n"))

    ;; 7. Summarize the stream with std/seq: how many tokens, how many of them
    ;;    are numbers, and what those number literals add up to.
    (console.log "--- summary ---")
    (let numbers (filter (fn [t] (== t.kind TokenKind:NUMBER)) tokens))
    (let literal-sum (reduce (fn [acc t] (+ acc t.value)) 0 numbers))

    (console.log '"tokens: {(length tokens)}")
    (console.log '"numbers: {(length numbers)}")
    (console.log '"literal sum: {(literal-sum)}")
)

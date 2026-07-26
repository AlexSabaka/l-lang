;; std/text/regex -- a small, ASCII-only regular expression engine, written in l-lang (D67).
;;
;; WHY IN l-lang RATHER THAN ON THE FLOOR. One source compiles to every backend, so there is no
;; "which C engine" question and no dialect to diverge on. POSIX `<regex.h>` was the alternative and it
;; is a DIFFERENT LANGUAGE from what anyone expects here -- no lazy quantifiers, no lookaround, no
;; named groups, `[[:digit:]]` where `\d` is written -- which under D66 would have been exactly the
;; silent cross-backend divergence the JS deprecation exists to stop. An l-lang engine also carries no
;; libc dependency into the LLVM endgame.
;;
;; NOT AMBIENT. `(import "std/text/regex")` is required, exactly as `Range` needs `std/iter`. Preludes
;; are host-free leaves that import nothing; this imports `std/core/string`, and making a whole matcher
;; ambient in every program is the wrong trade.
;;
;; SUPPORTED: literals, escaped metacharacters, `.`, `[abc]`, `[a-z]`, `[^…]`, grouping, alternation,
;; `*`, `+`, `?`, `^`, `$`, and `\d` `\w` `\s` with their negations.
;;
;; NOT SUPPORTED, and deliberately out of scope for v1: captures (which `replace` and `split` need
;; before they can be real), lookaround, backreferences, lazy quantifiers, Unicode properties, and
;; inline flags. Counted `{n,m}` is nearly free -- `RegexNode` already carries `min`/`max` and only the
;; parser arm is missing.
;;
;; THE MATCHER DOES NOT BACKTRACK. It carries the SET of positions a node can reach, so alternation
;; resolves breadth-first: `(a|ab)b` against `abb` succeeds without the exponential blowup a naive
;; backtracker suffers on that shape.
(
    (import "std/core/string")

    ;; One uniform node shape keeps the parser and the matcher uncomplicated. A tagged union would be
    ;; better typed and is not expressible here yet; `kind` is the tag.
    (defclass :internal RegexNode
        (let :ctor kind <- String)
        (let :ctor text <- String)
        (let :ctor children <- RegexNode[])
        (let :ctor negated <- Boolean)
        (let :ctor min <- Int)
        (let :ctor max <- Int)
    )

    (defclass :internal RegexParser
        (let :ctor pattern <- String)
        (mut :ctor index <- Int)
    )

    ;; A successful match: where it started, where it ended (EXCLUSIVE), and the text between.
    (defclass RegexMatch
        (let :ctor start <- Int)
        (let :ctor end <- Int)
        (let :ctor value <- String)
    )

    ;; A malformed pattern THROWS. The PoC used `assert` from `std/test`, which a library must not
    ;; depend on -- and a bad pattern is a real error rather than a failed expectation.
    (fn :internal fail [msg <- String] -> Void (throw (Error msg)))

    ;; -- the parser --------------------------------------------------------------------------------

    (fn :internal parser-peek [parser <- RegexParser] -> String (char-at parser.pattern parser.index))

    (fn :internal parser-take [parser <- RegexParser] -> String (
        (let ch (parser-peek parser))
        (if (== ch "") (fail "regex: unexpected end of pattern"))
        (parser.index := (+ parser.index 1))
        (return ch)
    ))

    (fn :internal parser-expect [parser <- RegexParser expected <- String] -> Void (
        (let actual (parser-take parser))
        (if (!= actual expected) (fail '"regex: expected {expected}, got {actual}"))
    ))

    (fn :internal parse-expression [parser <- RegexParser] -> RegexNode (
        (mut branches <- RegexNode[] [])
        (branches.push (parse-sequence parser))
        (while (== (parser-peek parser) "|") (
            (parser-take parser)
            (branches.push (parse-sequence parser))
        ))
        (if (== branches.length 1) (return branches[0]))
        (return (RegexNode "alternation" "" branches false 0 0))
    ))

    (fn :internal parse-sequence [parser <- RegexParser] -> RegexNode (
        (mut terms <- RegexNode[] [])
        (mut next (parser-peek parser))
        (while (&& (!= next "") (!= next ")") (!= next "|")) (
            (terms.push (parse-quantified parser))
            (next := (parser-peek parser))
        ))
        (return (RegexNode "sequence" "" terms false 0 0))
    ))

    ;; `[a-z]` -- expanded EAGERLY into the member string. Fine for ASCII, and it is what keeps
    ;; `class-contains` a plain scan rather than a range-interval test.
    (fn :internal expand-range [start <- String end <- String] -> String (
        (let start-code (codepoint-at start 0))
        (let end-code (codepoint-at end 0))
        (if (> start-code end-code) (fail "regex: character class range is backwards"))
        (mut out <- String "")
        (mut code start-code)
        (while (<= code end-code) (
            (out := (+ out (string-from-codepoints [code])))
            (code := (+ code 1))
        ))
        (return out)
    ))

    (fn :internal parse-class [parser <- RegexParser] -> RegexNode (
        (parser-expect parser "[")
        (mut negated false)
        (if (== (parser-peek parser) "^") (
            (parser-take parser)
            (negated := true)
        ))

        (mut members <- String "")
        (while (&& (!= (parser-peek parser) "") (!= (parser-peek parser) "]")) (
            (mut first (parser-take parser))
            (if (== first "\\") (first := (parser-take parser)))
            ;; A `-` immediately before the closing `]` is a literal dash, not a range opener.
            (if (&& (== (parser-peek parser) "-")
                    (!= (char-at parser.pattern (+ parser.index 1)) "]")) (
                (parser-take parser)
                (mut last (parser-take parser))
                (if (== last "\\") (last := (parser-take parser)))
                (members := (+ members (expand-range first last)))
            ) (
                (members := (+ members first))
            ))
        ))
        (parser-expect parser "]")
        (return (RegexNode "class" members [] negated 0 0))
    ))

    (fn :internal parse-atom [parser <- RegexParser] -> RegexNode (
        (match (parser-peek parser) {
            "[" => (parse-class parser)
            "(" => (
                (parser-take parser)
                (let grouped (parse-expression parser))
                (parser-expect parser ")")
                (return grouped))
            "." => ((parser-take parser) (RegexNode "any" "" [] false 0 0))
            "^" => ((parser-take parser) (RegexNode "start" "" [] false 0 0))
            "$" => ((parser-take parser) (RegexNode "end" "" [] false 0 0))
            "\\" => (
                (parser-take parser)
                (match (parser-peek parser) {
                    "d" => ((parser-take parser) (RegexNode "class" "0123456789" [] false 0 0))
                    "D" => ((parser-take parser) (RegexNode "class" "0123456789" [] true 0 0))
                    "w" => ((parser-take parser) (RegexNode "class" "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" [] false 0 0))
                    "W" => ((parser-take parser) (RegexNode "class" "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_" [] true 0 0))
                    "s" => ((parser-take parser) (RegexNode "class" " \t\n\r" [] false 0 0))
                    "S" => ((parser-take parser) (RegexNode "class" " \t\n\r" [] true 0 0))
                    _   => (return (RegexNode "literal" (parser-take parser) [] false 0 0))
                })
            )
            ch => (
                (parser-take parser)
                (if (|| (== ch "*") (== ch "+") (== ch "?") (== ch ")"))
                    (fail '"regex: unexpected character {ch}"))
                (RegexNode "literal" ch [] false 0 0)
            )
        })
    ))

    (fn :internal parse-quantified [parser <- RegexParser] -> RegexNode (
        (let atom (parse-atom parser))
        (match (parser-peek parser) {
            "*" => ((parser-take parser) (return (RegexNode "repeat" "" [atom] false 0 -1)))
            "+" => ((parser-take parser) (return (RegexNode "repeat" "" [atom] false 1 -1)))
            "?" => ((parser-take parser) (return (RegexNode "repeat" "" [atom] false 0 1)))
            _   => (return atom)
        })
    ))

    (fn :internal compile-pattern [pattern <- String] -> RegexNode (
        (let parser (RegexParser pattern 0))
        (let root (parse-expression parser))
        (if (!= (parser-peek parser) "") (fail "regex: unmatched closing parenthesis"))
        (return root)
    ))

    ;; -- the matcher -------------------------------------------------------------------------------

    (fn :internal class-contains [members <- String ch <- String] -> Boolean (
        (mut index 0)
        (while (< index (strlen members)) (
            (if (== (char-at members index) ch) (return true))
            (index := (+ index 1))
        ))
        (return false)
    ))

    ;; A node answers EVERY text position it can reach from `position`. Keeping the alternatives
    ;; instead of a single Boolean is the whole of the backtracking story -- and it is what makes
    ;; `(a|ab)b` resolve without the exponential blowup a naive backtracker has on that shape.
    (fn :internal match-node [node <- RegexNode text <- String position <- Int] -> Int[] (
        (mut out <- Int[] [])
        (if (== node.kind "literal") (
            (if (&& (< position (strlen text)) (== (char-at text position) node.text))
                (out.push (+ position 1)))
            (return out)
        ))
        (if (== node.kind "any") (
            (if (< position (strlen text)) (out.push (+ position 1)))
            (return out)
        ))
        (if (== node.kind "class") (
            (if (< position (strlen text)) (
                (let member (class-contains node.text (char-at text position)))
                (if (if node.negated (! member) member) (out.push (+ position 1)))
            ))
            (return out)
        ))
        (if (== node.kind "start") (
            (if (== position 0) (out.push position))
            (return out)
        ))
        (if (== node.kind "end") (
            (if (== position (strlen text)) (out.push position))
            (return out)
        ))
        (if (== node.kind "alternation") (
            (mut branch-index 0)
            (while (< branch-index node.children.length) (
                (let ends (match-node node.children[branch-index] text position))
                (mut end-index 0)
                (while (< end-index ends.length) (
                    (out.push ends[end-index])
                    (end-index := (+ end-index 1))
                ))
                (branch-index := (+ branch-index 1))
            ))
            (return out)
        ))
        (if (== node.kind "sequence") (
            (mut positions <- Int[] [position])
            (mut child-index 0)
            (while (< child-index node.children.length) (
                (mut next-positions <- Int[] [])
                (mut position-index 0)
                (while (< position-index positions.length) (
                    (let ends (match-node node.children[child-index] text positions[position-index]))
                    (mut end-index 0)
                    (while (< end-index ends.length) (
                        (next-positions.push ends[end-index])
                        (end-index := (+ end-index 1))
                    ))
                    (position-index := (+ position-index 1))
                ))
                (positions := next-positions)
                (child-index := (+ child-index 1))
            ))
            (return positions)
        ))
        ;; A repeated atom MUST advance. Discarding zero-width results is what stops `(^)*` and
        ;; `(a?)*` from looping forever -- the empty match is always available, so a repeat that
        ;; accepted it would never run out of iterations.
        (if (== node.kind "repeat") (
            (mut frontier <- Int[] [position])
            (mut count 0)
            (let limit (if (== node.max -1) (- (strlen text) position) node.max))
            (if (== node.min 0) (out.push position))
            (while (&& (< count limit) (> frontier.length 0)) (
                (mut next-frontier <- Int[] [])
                (mut start-index 0)
                (while (< start-index frontier.length) (
                    (let ends (match-node node.children[0] text frontier[start-index]))
                    (mut end-index 0)
                    (while (< end-index ends.length) (
                        (if (> ends[end-index] frontier[start-index]) (next-frontier.push ends[end-index]))
                        (end-index := (+ end-index 1))
                    ))
                    (start-index := (+ start-index 1))
                ))
                (count := (+ count 1))
                (frontier := next-frontier)
                (if (>= count node.min) (
                    (mut result-index 0)
                    (while (< result-index frontier.length) (
                        (out.push frontier[result-index])
                        (result-index := (+ result-index 1))
                    ))
                ))
            ))
            (return out)
        ))
        (throw (Error '"regex: unknown node kind {node.kind}"))
        (return out)
    ))

    (fn :internal longest-end [ends <- Int[]] -> Int (
        (mut longest ends[0])
        (mut index 1)
        (while (< index ends.length) (
            (if (> ends[index] longest) (longest := ends[index]))
            (index := (+ index 1))
        ))
        (return longest)
    ))

    (fn :internal first-match-from [root <- RegexNode text <- String start-at <- Int] -> RegexMatch? (
        (mut start start-at)
        (while (<= start (strlen text)) (
            (let ends (match-node root text start))
            (if (> ends.length 0) (
                (let end (longest-end ends))
                (return (RegexMatch start end (substr text start end)))
            ))
            (start := (+ start 1))
        ))
        (return nil)
    ))

    ;; -- the public surface ------------------------------------------------------------------------

    ;; The leftmost match, preferring the LONGEST end at that start, or nil.
    (fn first-match [pattern <- String text <- String] -> RegexMatch?
        (return (first-match-from (compile-pattern pattern) text 0)))

    ;; Does the pattern occur anywhere in the text?
    (fn is-match [pattern <- String text <- String] -> Boolean
        (return (!= (first-match pattern text) nil)))

    ;; Does the pattern match the text ENTIRELY? This is the form a `match` arm uses (D67): a pattern
    ;; asserts "x IS this shape", so searching would be the wrong default there.
    (fn is-full-match [pattern <- String text <- String] -> Boolean (
        (let root (compile-pattern pattern))
        (let ends (match-node root text 0))
        (mut index 0)
        (while (< index ends.length) (
            (if (== ends[index] (strlen text)) (return true))
            (index := (+ index 1))
        ))
        (return false)
    ))

    ;; Every non-overlapping match, left to right. This is where JS's `g` flag went (D67): global is
    ;; not a property of the pattern, it is which call you make.
    ;;
    ;; A zero-width match still advances the cursor by one, or the loop could not terminate.
    (fn find-all [pattern <- String text <- String] -> RegexMatch[] (
        (let root (compile-pattern pattern))
        (mut out <- RegexMatch[] [])
        (mut at 0)
        (while (<= at (strlen text)) (
            (let hit (first-match-from root text at))
            (if (== hit nil) (return out))
            (out.push hit)
            (at := (if (> hit.end hit.start) hit.end (+ hit.start 1)))
        ))
        (return out)
    ))

    ;; How many non-overlapping matches the text contains.
    (fn count-matches [pattern <- String text <- String] -> Int
        (let hits (find-all pattern text))
        (return hits.length))

    (export RegexMatch first-match is-match is-full-match find-all count-matches)
)

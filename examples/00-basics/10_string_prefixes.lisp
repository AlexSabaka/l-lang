;; Prefixed string literals (D67) -- a letter fused to the opening quote, no whitespace.
;;
;; `r"…"` is a RAW string: no escape processing. `f"…"` is a formatted string, the canonical spelling
;; of what `'"…"` has always done -- and `'"` is RETAINED as an alias rather than deprecated, because
;; `'` and `"` are the same key under shift while `f` and `"` are not, and `'` is already the quote
;; reader-macro so `'"` reads as a Lisp shorthand rather than as debt.
;;
;; A prefix is LEXICAL and nothing more. What comes out is an ordinary String, so nothing downstream --
;; the checker, either backend, any library -- can tell one was used. That is what keeps the mechanism
;; free: `r"…"` costs nothing in the type system and needs no runtime support anywhere.
;;
;; This also sidesteps `/pattern/flags` entirely (D67): `/` is never touched and stays division, which
;; is what a homoiconic reader requires -- a `/…/` literal is unfixably ambiguous with `(/ a b)`.
(
    (import "std/core/string")

    ;; -- raw ---------------------------------------------------------------------------------------

    ;; The motivating case. A regex wants a literal backslash, and doubling every one of them is the
    ;; single biggest ergonomic cost of writing patterns as ordinary strings.
    (console.log "raw:" r"\d+")
    (console.log "cooked:" "\\d+")
    (console.log "identical:" (== r"\d+" "\\d+"))

    ;; Three characters, not four: `\`, `d`, `+`. Raw means the escape was never processed, not that
    ;; anything extra was added.
    (console.log "length:" (strlen r"\d+"))

    ;; In a raw string an escape is simply two characters.
    (console.log "not a tab:" (strlen r"\t"))
    (console.log "a tab:" (strlen "\t"))

    ;; `\"` still does not TERMINATE the string, and both characters survive -- the one place raw
    ;; cannot mean "the lexer stops thinking", or a pattern could never contain a quote at all.
    (console.log "escaped quote:" (strlen r"a\"b"))

    ;; -- formatted ---------------------------------------------------------------------------------

    (let name "Sabaka")
    (let count 3)

    (console.log f"hello {name}")
    (console.log f"{count} of them")

    ;; The alias means the same thing, exactly.
    (console.log '"hello {name}")
    (console.log "aliases agree:" (== f"hello {name}" '"hello {name}"))

    ;; -- the prefix is not a keyword ----------------------------------------------------------------

    ;; A prefix needs its letter and its quote ADJACENT and at the very start of the token, so ordinary
    ;; identifiers that merely begin with `r` or `f` are untouched.
    (let robot "still an identifier")
    (let fname "so is this")
    (console.log "robot:" robot)
    (console.log "fname:" fname)

    ;; And a one-character string that happens to be "r" is a string, not a prefix looking for a quote.
    (console.log "the string r:" (strlen "r"))
)

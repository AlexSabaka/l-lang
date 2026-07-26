;; std/text/regex -- a regular expression engine written in l-lang (D67).
;;
;; The engine is l-lang, not a floor call to a host library, and that is the whole design: one source
;; compiles to every backend, so there is no dialect to diverge on. POSIX `<regex.h>` was the
;; alternative and it is a different language from what anyone writing `\d` expects -- which under D66
;; is exactly the silent cross-backend divergence the JS deprecation exists to prevent. Everything
;; below therefore answers identically on both backends, because it IS the same program.
;;
;; The import is required. A whole matcher has no business being ambient in every program.
(
    (import "std/text/regex")

    ;; -- searching ---------------------------------------------------------------------------------

    (console.log "search:" (is-match "cat" "a cat naps"))
    (console.log "absent:" (is-match "dog" "a cat naps"))

    ;; `is-full-match` ANCHORS. The distinction matters enough that both spellings exist: a search asks
    ;; "does this occur", a full match asks "is this the shape".
    (console.log "anchored:" (is-full-match "[a-z]+" "regex"))
    (console.log "not whole:" (is-full-match "[a-z]+" "regex99"))

    ;; -- the pattern language ----------------------------------------------------------------------

    (console.log "wildcard:" (is-full-match "c.t" "cut"))
    (console.log "class range:" (is-full-match "[a-z]+" "hello"))
    (console.log "negated class:" (is-full-match "[^0-9]+" "abc"))
    (console.log "group + alternation:" (is-full-match "gr(a|e)y" "grey"))
    (console.log "one or more:" (is-full-match "ab+c" "abbbc"))
    (console.log "optional:" (is-full-match "colou?r" "color"))
    (console.log "anchors:" (is-match "^cat$" "cat"))
    (console.log "shorthand:" (is-match r"\d+" "id-42"))

    ;; An ESCAPED metacharacter is a literal. This is the case that found D74 -- a match pattern's
    ;; string was not being decoded, so the engine could not compare against a backslash at all.
    (console.log "escaped dot:" (is-full-match r"v1\.2" "v1.2"))
    (console.log "escape is literal:" (is-full-match r"v1\.2" "v1x2"))

    ;; ALTERNATION BACKTRACKS. `(a|ab)b` against `abb` requires trying the second branch after the
    ;; first leads nowhere -- the matcher carries the SET of reachable positions rather than committing
    ;; to one, which is also what keeps this shape from blowing up exponentially.
    (console.log "backtracks:" (is-full-match "(a|ab)b" "abb"))

    ;; -- what matched, and where -------------------------------------------------------------------

    ;; `first-match` answers an OPTIONAL, so the checker makes the nil case impossible to forget (D9).
    (let hit (first-match r"\d+" "id-42-x"))
    (if (!= hit nil)
        (console.log "found:" hit.value "at" hit.start ".." hit.end)
        (console.log "no match"))

    ;; -- every match -------------------------------------------------------------------------------

    ;; JS spells this with a `g` flag on the pattern; here it is simply a different call, because
    ;; "global" was never a property of the pattern (D67).
    (console.log "count:" (count-matches r"\d+" "a1 b22 c333"))
    (for :each m :from (find-all r"\d+" "a1 b22 c333") :then (
        (console.log "  match:" m.value)
    ))

    ;; -- something real ----------------------------------------------------------------------------

    (let email-pattern r"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]+")
    (console.log "email:" (is-match email-pattern "write to user@example.com today"))
    (console.log "not an email:" (is-match email-pattern "no address here"))

    (console.log "phone:" (is-match r"\(\d\d\d\)\s+\d\d\d\-\d\d\d\d" "call (123) 456-7890"))
)

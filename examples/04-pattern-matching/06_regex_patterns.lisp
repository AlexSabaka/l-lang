;; A regex as a MATCH PATTERN (D67) -- `match s { r"ca+t" => … }`.
;;
;; Sugar, and cheap sugar: it lowers at parse time to the `:when` guard that already worked, so this
;; is shorter rather than newly possible.
;;
;;     r"ca+t" => …          becomes          s :when (is-full-match r"ca+t" s) => …
;;
;; The lowering happens in the AstBuilder rather than in the desugar pass, and that is forced: a
;; synthesized node carries no `_parent`, and the symbol table resolves scope by climbing `_parent`
;; through the pre-desugar tree. At AstBuilder time the nodes are in the tree before the symbol table
;; is built, so `is-full-match` resolves like any other name -- which is also why a missing import is
;; an ordinary LL0210 here rather than anything the sugar has to special-case.
(
    (import "std/text/regex")
    (import "std/core/string")

    ;; ANCHORED, not a search. A pattern asserts "x IS this shape", so a regex arm is a FULL match --
    ;; Ruby's searching `when /re/` is the rejected alternative, because a pattern that silently
    ;; matches a substring is a bug factory. Spell a search `r".*ca+t.*"` and mean it.
    (fn classify [s <- String] -> String (
        (match s {
            r"ca+t"   => "a cat, however long"
            r"\d+"    => "all digits"
            r"[a-z]+" => "a lowercase word"
            _         => "something else"
        })
    ))

    (console.log "cat:" (classify "cat"))
    (console.log "caaaat:" (classify "caaaat"))
    (console.log "42:" (classify "42"))
    (console.log "hello:" (classify "hello"))
    (console.log "!!:" (classify "!!"))

    ;; The anchoring, shown rather than asserted: the cat is in there, and the arm does not fire.
    (console.log "a caaaat naps:" (classify "a caaaat naps"))

    ;; ...and the search spelling that does fire.
    (fn contains-cat [s <- String] -> Boolean (
        (match s {
            r".*ca+t.*" => #t
            _           => #f
        })
    ))
    (console.log "search:" (contains-cat "a caaaat naps"))

    ;; A DELIBERATE, VISIBLE PRICE: `r"cat"` and `"cat"` mean different things in pattern position --
    ;; regex versus equality. The prefix is right there in the source, which is the whole reason the
    ;; distinction is allowed to exist at all.
    (fn literal-or-regex [s <- String] -> String (
        (match s {
            "c.t"  => "matched the LITERAL three characters"
            r"c.t" => "matched the regex"
            _      => "neither"
        })
    ))
    (console.log "c.t:" (literal-or-regex "c.t"))
    (console.log "cut:" (literal-or-regex "cut"))

    ;; An explicit `:when` still applies on a regex arm, and BOTH must hold. Arms are tried in order,
    ;; so the guarded one goes first.
    (fn size-of-number [s <- String] -> String (
        (match s {
            r"\d+" :when (> (strlen s) 2) => "a long number"
            r"\d+"                        => "a short number"
            _                             => "not a number"
        })
    ))
    (console.log "7:" (size-of-number "7"))
    (console.log "12345:" (size-of-number "12345"))
    (console.log "abc:" (size-of-number "abc"))
)

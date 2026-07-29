;; ADVERSARIAL: `for` DOES NOT HAVE TO BE A BUILT-IN. It is expressible as a user macro, today.
;;
;; The motivating complaint was that `for` is the weakest construct in the language -- three unrelated
;; clause families (`:init/:cond/:step`, `:each/:from`, `:then/:else`) welded into one production,
;; carrying five of the grammar's 101 rules and a `duplicateClauses` field that exists only so the
;; parser can report on itself. D69 wants forms like this to migrate onto a metaprogramming tier over
;; time; D95 measured why they could not.
;;
;; THIS FILE IS THE EXISTENCE PROOF, and it uses `for`'s REAL surface -- the same `:init :cond :step
;; :then` a reader already knows, not a positional stand-in. `my-for` below is an ordinary `defmacro`.
;;
;; WHY IT IS `defmacro` AND NOT `defsyntax`, which is what the migration would prefer:
;;
;;   `:init` and friends are `:keyword` CLAUSES, and D95 measured that those are welded to heads the
;;   grammar already knows -- of 28 keyword-headed productions only FIVE have a surface a user could
;;   reproduce. `defsyntax` receives an AST, so a call site must PARSE before it can expand, and this
;;   one does not: measured, `(u c :then b)` is `Expecting token of type --> RParen`.
;;
;;   `defmacro` runs before the parser has an opinion (D95's seam, D102's build), so the surface is
;;   whatever the lexer can tokenise. That is the one thing the token tier buys.
;;
;; The `defsyntax` route needs a generic clause surface, which was probed and REVERTED: the grammar
;; half is five lines and works, but the builder has nowhere to put a clause, so `(f :then 7)` returns
;; 70 -- identical to `(f 7)`, with the keyword silently gone. Recorded in roadmap; not shipped.
(
    ;; -- `for` as a macro, with the real clause surface ---------------------------------------------
    ;;
    ;; The identity is the one every C programmer knows and the one C3's hand-written proof used:
    ;;
    ;;     for (init; test; step) body   ==   { init; while (test) { body; step } }
    ;;
    ;; The four `:keyword` tokens bind to parameters like anything else -- a macro receives TOKENS, and
    ;; a keyword is just a token. `ki`/`kc`/`ks`/`kt` are the clause markers, never referenced; naming
    ;; them is how a positional tier accepts a named surface.

    (defmacro my-for [ki ini kc tst ks stp kt bod]
        (list "(" "(" ini ")" "(" "while" tst "(" bod stp ")" ")" ")"))

    (my-for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (console.log "i =" i))

    ;; -- and it composes with an ordinary loop, because it EXPANDS to one ---------------------------
    ;;
    ;; Nothing downstream knows `my-for` existed. By the time the parser runs there is a block and a
    ;; `while`, so every later pass -- types, HIR, both backends -- sees code it already understood.

    (mut total 0)
    (my-for :init (mut k 1) :cond (< k 5) :step (k := (+ k 1)) :then (total := (+ total k)))
    (console.log "1+2+3+4 =" total)

    ;; -- a PARAMETER NAME MUST BE AN IDENTIFIER, and that is refused by name ------------------------
    ;;
    ;; `cond` lexes as a keyword, and a keyword cannot be referenced as a variable anywhere in l-lang
    ;; -- `(let cond 1)` is a parse error too. Filtering such names out silently was the first attempt
    ;; and was worse: the handler ended up declared with fewer parameters than it was written with, so
    ;; the ARITY refusal fired on a correct call site and pointed at the wrong thing entirely.
    ;;
    ;;   (defmacro bad [cond] …)   -- refused: "'cond' cannot be a macro parameter name"
    ;;
    ;; which is why the clause markers above are `kc` rather than `kcond`-shaped names.
    (console.log "done")
)

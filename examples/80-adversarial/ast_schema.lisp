;; ADVERSARIAL: the AST SCHEMA is available to l-lang, generated from the compiler's own `ast.ts` (M2).
;;
;; `std/llang/ast` is the mirror of `src/compiler/frontend/ast.ts`, emitted by `npm run ast:stdlib` and
;; kept honest by `npm run test:docs`, which regenerates it and goes red if the committed copy drifted
;; -- the same gate the EBNF grammar already has, against the same failure: a node kind added to the
;; compiler while the l-lang-side mirror still describes the old set is a mirror that LIES.
;;
;; IT DECLARES NO FIELD ACCESSORS, ON PURPOSE. A quoted form is a map (D3d) and `n.nodes` already
;; reads it -- and that read is already TOTAL, since an absent field answers nil rather than raising
;; (measured on both backends). Eighty generated accessors over a working syntax would be ceremony.
;; `std/llang/reflect` needs its accessors because a reflection descriptor's shape varies by kind and
;; `t["extends"]` on a root class really does raise; that argument does not transfer here.
;;
;; What the module adds is what member access cannot tell you: WHICH KINDS EXIST, what fields each
;; declares, and which of those hold CHILD NODES. The last one is the interesting one -- it is what a
;; generic walker follows, and nothing in l-lang could derive it before.
(
    (import "std/llang/ast")

    ;; -- the kinds are named, so a typo is not a silently-false comparison -------------------------
    ;;
    ;; `(== n._type "lst")` is false forever and nothing complains. `(is-list n)` is a call to a
    ;; function that either exists or does not.

    (let expr '(+ 1 2))
    (console.log "type:" (node-type expr))
    (console.log "is-list:" (is-list expr))
    (console.log "is-while:" (is-while expr))

    ;; -- the schema is the whole node set, and it is generated -------------------------------------
    ;;
    ;; 86 is `ast.ts`'s count of interfaces extending `ASTNode<...>`. If someone adds an 87th and does
    ;; not regenerate, `test:docs` is red before this line is wrong.

    (let ks (kinds))
    (console.log "kind count:" ks.length)
    (console.log "known:" (kind-exists "while") (kind-exists "no-such-kind"))

    ;; -- fields, and the CHILD subset --------------------------------------------------------------
    ;;
    ;; A `for` declares six fields; five of them hold nodes. The sixth, `duplicateClauses`, is a
    ;; Boolean the parser sets for diagnostics -- so a walker that followed every field would try to
    ;; descend into `false`. Separating the two is the reason this module exists.

    (console.log "for fields:" (fields-of "for"))
    (console.log "for children:" (child-fields-of "for"))

    ;; Totality: an unknown kind answers an empty vector on both accessors, never an error.
    (console.log "unknown fields:" (fields-of "no-such-kind"))

    ;; -- and now the thing none of this was possible without: a GENERIC WALK -----------------------
    ;;
    ;; Counting the nodes in a form requires knowing which fields to descend into, for a kind the
    ;; walker was not written against. Hand-counted from the source forms:
    ;;
    ;;   `'(+ 1 2)`            the list, plus `+`, `1`, `2`                        = 4
    ;;   `'(f (> x 10) "big")` the outer list, `f`, the inner list (itself 1+3=4),
    ;;                         and "big"                                = 1+1+4+1  = 7

    (fn count-nodes [n <- Any] -> Int (
        (if (== n nil) (return 0))
        (let k (node-type n))
        (if (== k nil) (return 0))
        (mut total 1)
        (for :each f :from (child-fields-of k) :then (
            (let v (map-get n f))
            (if (!= v nil) (
                ;; A child field is either one node or a vector of them; `nodes` is a vector.
                (if (== f "nodes")
                    (for :each c :from v :then (total := (+ total (count-nodes c))))
                    (total := (+ total (count-nodes v))))
            ))
        ))
        (return total)))

    (console.log "nodes in '(+ 1 2):" (count-nodes expr))
    (console.log "nodes in nested:" (count-nodes '(f (> x 10) "big")))
    (console.log "done")
)

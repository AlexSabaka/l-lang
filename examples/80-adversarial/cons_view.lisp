;; ADVERSARIAL: the cons/list layer is DERIVED from the AST datum, and this is the proof (D101).
;;
;; The ruling taken 2026-07-22 said homoiconicity means BOTH -- the AST datum is the source of truth,
;; and cons/list is a DERIVED layer. For over a year that ruling had no D-number and lived as a string
;; in `src/test/manifest.ts`, and the claim was never demonstrated: `12-quote-macros/00_quoting.lisp`
;; still says in its own comment that `'(+ 1 2)` "should result in a list: ["+", 1, 2]" and treats the
;; map datum as the thing standing in its way.
;;
;; It is not in the way. `["+" 1 2]` is twenty lines of ORDINARY L-LANG over what already exists --
;; quote's datum (D3d, and on the C backend as of M1) and the generated schema in `std/llang/ast`
;; (M2). No compiler change, no new primitive, no `eval`.
;;
;; AND IT IS GENERIC, which is the part that makes "derived" a fact rather than a demo. The walk is
;; driven by `child-fields-of`, so it converts a node kind it was never told about -- the nested `if`
;; below is not special-cased anywhere in this file. That is what M2's schema was generated FOR.
;;
;; What this does NOT show, and D101 says so: the RETURN trip. `(eval x)` is still LL0236 on both
;; backends. A cons view is code-as-data read back out; running it is a different tier.
(
    (import "std/llang/ast")

    ;; The whole derived layer. Three cases and a default:
    ;;
    ;;   a LIST      -> its elements, converted
    ;;   a LEAF      -> the value it carries (`id` for a name, `value` for a literal)
    ;;   anything    -> [kind, …its child fields in declaration order]
    ;;
    ;; The third case is the generic one and needs the schema: which of a kind's fields hold NODES is
    ;; not derivable from the datum itself, and a walker that followed every field would descend into
    ;; a Boolean.
    (fn to-cons [n <- Any] -> Any (
        (if (== n nil) (return nil))
        (let k (node-type n))
        (if (== k nil) (return n))

        (if (== k "list") (
            (mut xs [])
            (for :each c :from n.nodes :then (xs := (xs.concat [(to-cons c)])))
            (return xs)))

        (let kids (child-fields-of k))
        (if (== kids.length 0) (
            (if (!= n.id nil) (return n.id))
            (if (!= n.value nil) (return n.value))
            (return k)))

        (mut out [k])
        (for :each f :from kids :then (
            (let v (map-get n f))
            (if (!= v nil) (out := (out.concat [(to-cons v)])))))
        (return out)))

    ;; -- the exact shape `00_quoting.lisp` has been asking for since it was written -----------------

    (console.log "sum:   " (to-cons '(+ 1 2)))
    (console.log "data:  " (to-cons '(1 2 3)))

    ;; -- a kind the walker was never told about ----------------------------------------------------
    ;;
    ;; `if` is a NODE, not a list -- the parser recognised it, so it has `condition`/`then`/`else`
    ;; fields rather than `nodes`. Nothing here mentions `if`; the schema does.

    (console.log "nested:" (to-cons '(if (> x 10) "big" "small")))

    ;; -- and the datum is still the source of truth ------------------------------------------------
    ;;
    ;; The cons view is a READING of the datum, not a replacement for it. Both are available at once,
    ;; which is what "BOTH" in the ruling means.

    (let e '(+ 1 2))
    (console.log "kind:  " e._type)
    (let h (head e.nodes))
    (console.log "head:  " h.id)
    (console.log "done")
)

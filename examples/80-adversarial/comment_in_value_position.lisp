;; ADVERSARIAL: a COMMENT is not a form, and a block's LAST item decides its value.
;;
;; SILENT WRONG ANSWER on JS, `ELL0106 'comment'` on C. `classifyList` -- D25's single answer to
;; "what is this list" -- built its node list from a raw `ctx.expression.map`, so a comment kept a
;; POSITIONAL SLOT. A block's value is its last item, so a trailing `;;` comment BECAME the value:
;;
;;     (let a ( (console.log "x") 42 ;; note ))   ->  a = nil   on JS, refused on C
;;     (let b ( (console.log "x") 42        ))   ->  b = 42    on both
;;
;; Two spellings of one block, differing only by a comment, disagreeing on the value. On JS
;; `visitComment` emits `{ type: "Literal", value: null }`, so the block quietly evaluated to nil with
;; no diagnostic anywhere; on C nothing lowers a comment as an expression, so it surfaced as a refusal
;; naming a construct the author never wrote in value position.
;;
;; THE RULING WAS ALREADY MADE, one layer up and never applied here. `AstBuilder.positionalExpressions`
;; carries it verbatim -- "comments are not values and never occupy a slot. One helper, so the four
;; cannot disagree" -- and `if`/`when`/`while` are built through it. A plain LIST was not.
;;
;; Fixed in `classifyList` rather than in either frontend: D25 is the one question every pass asks, so
;; a single filter answers it for grammar_v2 and the PEG together. The comment stays in the tree --
;; `quote` emits the raw node as DATA and never consults the classifier.
(
    ;; -- a trailing comment must not become the value ----------------------------------------------

    (let a (
        (console.log "  effect a")
        42  ;; the trailing comment that used to be this block's value
    ))
    (console.log "trailing:  " a)

    ;; The same block WITHOUT the comment. These two must agree -- that is the whole finding.
    (let b (
        (console.log "  effect b")
        42
    ))
    (console.log "no comment:" b)

    ;; -- a comment in every other slot of a block --------------------------------------------------
    ;;
    ;; LEADING and INTERIOR comments were survivable before (a block's value is its last item, so
    ;; nothing read them), which is exactly why only the trailing one was ever noticed. Pinned anyway:
    ;; the fix removes the slot everywhere, so all three positions have to keep working.

    (let c (
        ;; leading
        (console.log "  effect c")
        ;; interior
        7
        ;; trailing
    ))
    (console.log "surrounded:" c)

    ;; -- a comment as the ONLY item ----------------------------------------------------------------
    ;;
    ;; With the slot gone this list has no items at all, so it is `empty` -- nil, the same answer `()`
    ;; gives. The alternative would have been a block whose one item is unlowerable.

    (let d (
        ;; nothing but this
    ))
    (console.log "only:      " d)

    ;; -- redundant parens PLUS a comment -----------------------------------------------------------
    ;;
    ;; `((+ 1 2))` is a `grouping` (D25), decided by the list having exactly ONE node, and a comment
    ;; makes it two -- so this is a BLOCK, and it must still answer 3. The classifier deliberately
    ;; tests the RAW length here: a `grouping` yields its inner node and discards the rest, so treating
    ;; this as one would silently drop the comment from the output, which Zb rules against.

    (let e (
        (+ 1 2)  ;; a note on a grouping
    ))
    (console.log "grouping:  " e)

    ;; -- CALL position, which is the same bug and is not about values ------------------------------
    ;;
    ;; `(f ;; c)` classified as a call to `f` with ONE argument -- the comment. D1 says `(f)` on a
    ;; nullary function is a call, so this must be a zero-argument call and not an arity error.

    (fn nullary [] -> Int (return 5))
    (console.log "nullary:   " (nullary ;; a note inside the call
    ))

    ;; An argument list with a comment BETWEEN the arguments: two arguments, not three.
    (fn add2 [x <- Int y <- Int] -> Int (return (+ x y)))
    (console.log "args:      " (add2 1 ;; between
        2))

    ;; -- a comment inside a FUNCTION BODY whose value is the return ---------------------------------
    ;;
    ;; A body is a block, so a trailing comment there took the same path -- and an implicit-return
    ;; function is where it would be least visible.

    (fn implicit [] -> Int (
        (console.log "  effect f")
        99  ;; the value
    ))
    (console.log "implicit:  " (implicit))
)

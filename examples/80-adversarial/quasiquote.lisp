;; ADVERSARIAL: `` ` `` is a TEMPLATE and `~x` is a hole in it (D96).
;;
;; Quote alone cannot build a form out of pieces. `'(if c nil body)` NAMES `c` and `body`; it does not
;; carry what they hold. So a handler could inspect a form (M3) and never construct one -- which is
;; the whole job of `defsyntax`, whose row in D69's table says it receives an AST and returns an AST.
;;
;; TWO CHARACTERS, BOTH MEASURED FREE BEFORE THEY WERE TAKEN.
;;
;;   ` -- not a token, and its only occurrences in the corpus and stdlib were inside comments.
;;   ~ -- a legal operator-name CHARACTER that nothing anywhere spells as one. D61's bitwise NOT is
;;        `bnot`, a named floor function, so `~` was carrying no meaning at all.
;;
;; `,` was the first choice and was REJECTED ON MEASUREMENT: comma is an optional separator in eight
;; productions and `grid[1, 1]` is real multi-index syntax, so `` `grid[i, j] `` would have been
;; genuinely ambiguous. `~x` tight vs `~ x` spaced is the adjacency rule the language already has --
;; D88/N4 gave it to `..`, D93 gave it to `...`.
;;
;; EVERYTHING HERE IS FOLDED BEFORE CODEGEN. These are `:comptime` functions, so what reaches the
;; backends is literals; the templates are built and consumed inside the compiler.
(
    ;; -- a hole takes the VALUE, not the name ------------------------------------------------------
    ;;
    ;; `(mk-add 3 4)` builds the form `(+ 3 4)`. Note what is NOT here: nothing evaluates it, so the
    ;; answer 7 appears nowhere. A template produces code, not results.

    (fn :comptime mk-add [a <- Int b <- Int] -> Any (return `(+ ~a ~b)))
    (let f (mk-add 3 4))
    (console.log "built kind:" f._type)
    (console.log "built head:" f.nodes[0].id)
    (console.log "built args:" f.nodes[1].value f.nodes[2].value)

    ;; -- a template with no holes is exactly a quote -----------------------------------------------

    (fn :comptime plain [] -> Any (return `(a b)))
    (let p (plain))
    (console.log "no holes:" p.nodes[0].id p.nodes[1].id)

    ;; -- a hole can take a FORM, which is what makes the tier work ---------------------------------
    ;;
    ;; Splicing a scalar is the easy half. A handler is given SUB-FORMS and has to put them inside a
    ;; bigger one -- so the spliced value has to arrive as a node and keep its structure.

    (fn :comptime negate [g <- Any] -> Any (return `(! ~g)))
    (let n (negate '(> x 1)))
    ;; Bound rather than chained: a member off a CALL result -- `(head xs).id` -- is not a spelling
    ;; the grammar accepts (LL0210), which is D1's territory and nothing to do with templates.
    (let inner n.nodes[1])
    (let inner-head (head inner.nodes))
    (console.log "wrapped head:" n.nodes[0].id)
    (console.log "wrapped inner:" inner._type inner-head.id)

    ;; -- every literal kind survives the splice, and Int stays Int ---------------------------------
    ;;
    ;; D51 splits Int from Real. A spliced 2 is an `integer-number` and a spliced 2.5 a `float-number`,
    ;; because `valueToNode` decides by the value and not by a single numeric default.

    (fn :comptime lit [x <- Any] -> Any (return `(v ~x)))
    (let li (lit 2))
    (let lr (lit 2.5))
    (let ls (lit "s"))
    (let lb (lit true))
    (console.log "int:" li.nodes[1]._type)
    (console.log "real:" lr.nodes[1]._type)
    (console.log "string:" ls.nodes[1]._type)
    (console.log "bool:" lb.nodes[1]._type)

    ;; -- THE TEMPLATE IS COPIED, NOT FILLED IN PLACE -----------------------------------------------
    ;;
    ;; A handler is called once per use site. A template that filled its own holes would come back
    ;; already-filled on the second call -- the shared-mutable-default bug, visible only on the SECOND
    ;; expansion. Two calls, two different answers, is the whole test.

    (let one (mk-add 1 1))
    (let two (mk-add 9 9))
    (console.log "call 1:" one.nodes[1].value)
    (console.log "call 2:" two.nodes[1].value)

    ;; -- what is REFUSED, pinned in test:diagnostics ------------------------------------------------
    ;;
    ;;   (console.log ~x)   -- LL0110: a hole with no template around it. Reported at the SYNTAX
    ;;                         stage; before the rule it reached codegen as `ELL0106 no lowering
    ;;                         exists for 'unquote'`, which names a backend gap for a syntax mistake.
    ;;
    ;; And what is NOT refused, deliberately: a SPACED `~ x` is the operator character followed by an
    ;; expression, exactly as it has always been. That is the asymmetry with `...`, whose spaced form
    ;; IS an error (LL0037) -- because `...` has no other meaning and `~` does.
    (console.log "done")
)

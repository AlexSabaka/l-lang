;; ADVERSARIAL: `defmacro` -- the TOKEN tier, and the only one that can introduce SURFACE (D102).
;;
;; D69 distinguishes the tiers by what each handler receives; D95 by when each runs and places this
;; one between LEX and PARSE. That seam is the entire difference, and it buys exactly one thing that
;; `defsyntax` cannot buy at any price.
;;
;; D95 MEASURED THE LIMIT: of 28 keyword-headed productions, only FIVE have a surface a user could
;; reproduce. `:keyword` clauses, `(:else …)` arms, bare-keyword infix and match braces are welded to
;; heads the grammar already knows, so they are parse errors on any other. An AST-level tier can only
;; recombine surfaces the parser already accepts. This one runs before the parser has an opinion.
;;
;; That claim is not argued here, it is EXERCISED: the `:then` clause below is a parse error for
;; `defsyntax` -- measured, `Expecting token of type --> RParen` -- and works here.
;;
;; WHAT A HANDLER RECEIVES is a vector of token IMAGES, and returns one. D101 names three
;; representations and warns against conflating them: the AST datum, the cons VIEW of it, and a TOKEN
;; list. This is the third, and it is deliberately the plainest thing that can be one -- a handler uses
;; the vector and string operations the comptime evaluator already had, needing no new value kind and
;; no token object model that would then have to track the lexer. The cost is stated rather than
;; hidden: a handler sees `":then"` as a string and cannot ask what KIND of token it is.
(
    ;; -- a handler builds its answer out of tokens ---------------------------------------------------
    ;;
    ;; `e` arrives as ["21"]. `list` is the floor's own variadic constructor and splices, so the result
    ;; is ["(" "+" "21" "21" ")"] -- which is re-lexed and parsed as `(+ 21 21)`.

    (defmacro twice [e] (list "(" "+" e e ")"))
    (console.log "twice 21:" (twice 21))

    ;; -- THE SURFACE CASE: a `:keyword` clause on a user-defined head --------------------------------
    ;;
    ;; `(unless-kw c :then body)`. The `:then` is a token the grammar accepts after `when` and nowhere
    ;; else, so this call site does not parse -- and does not need to, because the expansion happens
    ;; first. This is the one thing the token tier exists for.

    (defmacro unless-kw [c kw body] (list "(" "if" c "nil" body ")"))
    (let x 5)
    (unless-kw (> x 10) :then (console.log "5 is not > 10"))
    (unless-kw (< x 10) :then (console.log "this must not print"))

    ;; -- a handler can INSPECT its tokens, not just place them ---------------------------------------
    ;;
    ;; `head` and `empty` are the floor's own sequence primitives. Here the handler branches on how
    ;; many tokens it was handed, which a function could not do -- by the time a function is called its
    ;; arguments are values, and their spelling is gone.

    (defmacro arity-of [e] (if (empty (tail e)) (list "\"one\"") (list "\"many\"")))
    (console.log "one token:" (arity-of 7))
    (console.log "many tokens:" (arity-of (+ 1 2)))

    ;; -- expansion reaches a FIXED POINT, and nested calls expand outermost-first --------------------
    ;;
    ;; `twice` inside `twice`: the outer expands first, the inner is found on the next round. A budget
    ;; bounds it -- a handler that expands into its own call has no fixed point, and a compiler that
    ;; never returns is worse than one that refuses.

    (console.log "nested:" (twice (twice 5)))

    ;; -- what is REFUSED, pinned in test:diagnostics ------------------------------------------------
    ;;
    ;;   two `defmacro` of one name        -- the later would silently win (the D72/LL0031 shape)
    ;;   wrong number of forms             -- a defmacro matches on shape, count included
    ;;   a handler that expands into itself -- no fixed point; a budget, not a hope
    ;;   a handler answering a non-vector  -- that is a function with the wrong keyword
    ;;   `(defmacro)` with no name         -- LL0023, RE-AIMED: not "unimplemented" but "the expander
    ;;                                        could not read this", which is what it now means
    (console.log "done")
)

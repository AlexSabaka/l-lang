;; ADVERSARIAL: `defsyntax` -- the tier that receives a FORM and returns one (D69/D95).
;;
;; D3 reserved `defmacro` and `defsyntax` and its own standing banner recorded that only one of them
;; was actually reserved: `defsyntax` gave `LL0210 is not defined`, the message any typo gets. D69
;; ruled the three tiers by what each handler RECEIVES; D95 ruled when each one RUNS. This is the
;; first of them to exist.
;;
;; IT RUNS BETWEEN PARSE AND SYNTAX, and that seam is forced rather than chosen:
;;
;;   * LATER is impossible -- an expansion INTRODUCES code, and the symbol table would have been built
;;     over a tree that no longer exists. That is precisely why `:comptime` CAN run after symbols: it
;;     only ever deletes declarations and folds expressions to constants, never adds a name.
;;   * EARLIER is impossible -- there is no tree yet.
;;
;; Two consequences follow from the placement, neither of them a decision. A handler is MODULE-LOCAL
;; (imports resolve two stages later, so a `defsyntax` cannot be exported or imported -- the limit
;; `defmodifier` already carries under D72), and a handler sees NO TYPES.
;;
;; `defmacro` is UNCHANGED and still refused by name (LL0023). It receives TOKENS, which needs a whole
;; pre-parse stage; `defsyntax` needs no new stage machinery, which is why it is the tier that proves
;; the layer.
(
    ;; -- what a function CANNOT do ----------------------------------------------------------------
    ;;
    ;; A handler is handed the AST of each argument, UNEVALUATED. That is the entire difference from a
    ;; function, and `unless` is the smallest thing that shows it: the body is placed in a branch that
    ;; does not run, so it is never evaluated at all. A function would have evaluated it before being
    ;; called and the side effect would happen regardless.

    (defsyntax unless [c body] `(if ~c nil ~body))

    (mut ran 0)
    (fn note [] -> Int ((ran := (+ ran 1)) (return ran)))

    (let x 5)
    (unless (> x 10) (console.log "5 is not > 10"))
    (unless (< x 10) (note))
    (console.log "side effects:" ran)

    ;; -- an argument form can be used MORE THAN ONCE ------------------------------------------------
    ;;
    ;; `twice` places its argument in two positions. This is also where macro hygiene would show if the
    ;; template captured names -- it does not capture here, and hygiene is NOT claimed by this tier.

    (defsyntax twice [e] `(+ ~e ~e))
    (console.log "twice 4:" (twice 4))

    ;; -- and REORDERED, which is the other thing a call cannot do -----------------------------------

    (defsyntax flip [a b] `(- ~b ~a))
    (console.log "flip 3 10:" (flip 3 10))

    ;; -- a handler can INSPECT the form it was given, not just place it -----------------------------
    ;;
    ;; The parameter holds an AST, so the comptime subset's member access works on it (M3). Here the
    ;; handler branches on the SHAPE of its argument rather than on a value.

    (defsyntax show-kind [f] `(console.log "arg kind:" ~f._type))
    (show-kind (+ 1 2))

    ;; -- expansions COMPOSE, and the depth budget is what bounds them -------------------------------
    ;;
    ;; `unless2` expands into `unless`, which expands into `if`. The result is re-walked after each
    ;; expansion, which is what makes composition work -- and what makes a self-expanding handler need
    ;; a budget rather than a hope.

    (defsyntax unless2 [c body] `(unless ~c ~body))
    (unless2 (> x 10) (console.log "composed through two handlers"))

    ;; -- a quoted form is DATA and is NOT expanded --------------------------------------------------
    ;;
    ;; `'(unless a b)` means exactly what it says. Expanding inside a quote would make quote mean
    ;; something other than its own contract.

    (let q '(unless a b))
    (let qh (head q.nodes))
    (console.log "quoted, unexpanded:" qh.id)

    ;; -- what is REFUSED, pinned in test:diagnostics ------------------------------------------------
    ;;
    ;;   two `defsyntax` of one name           -- LL0038: the later would silently win, which is how
    ;;                                            D72/LL0031 records a decorator quietly stopping
    ;;   wrong number of forms                 -- LL0039: a defsyntax matches on shape, count included
    ;;   a handler that expands into itself    -- LL0040: no fixed point; a budget, not a hope
    ;;   a body outside the comptime subset    -- LL0041: carries the interpreter's own message
    ;;   a handler that answers a value        -- LL0042: that is a function with the wrong keyword
    ;;   `(defmacro m [] 1)`                   -- LL0023, unchanged: it needs a pre-parse stage
    (console.log "done")
)

;; ADVERSARIAL: `:comptime` can RECEIVE and INSPECT a form -- the evaluator holds an AST now (M3).
;;
;; `CTValue` ran `bigint | number | string | boolean | null | CTValue[]` -- scalars and arrays -- so the
;; comptime interpreter could not hold a form even in principle, and D69's `defsyntax` tier ("receives
;; a full AST") could not have been written in it at any price. Passing one was refused outright:
;; `LL0099 argument is a 'list', not a compile-time constant`.
;;
;; A QUOTED FORM IS A COMPILE-TIME CONSTANT, on LL0099's own terms rather than as an exception to it.
;; That rule exists because the interpreter models no runtime state, so every evaluation has to start
;; from something already finished. A quoted form is already finished -- more so than `3`, which at
;; least had to be produced -- because quote's entire semantics is that its operand is NOT evaluated
;; (D3d). Passing one costs the evaluator nothing and can fail in no way.
;;
;; EVERYTHING BELOW IS FOLDED BEFORE CODEGEN. The emitted C holds `ll_str_lit("list")`, `ll_str_lit("+")`
;; and `INT64_C(3)` as literals -- no call survives, and the `:comptime` declarations are deleted. So
;; this file is not testing a runtime library; it is testing the compiler's own evaluator.
(
    ;; -- reading a form's shape --------------------------------------------------------------------
    ;;
    ;; `'(+ 1 2)` is a `list` of three nodes. None of this evaluates the addition: nothing here is 3.

    (fn :comptime kind-of [f <- Any] -> String (return f._type))
    (fn :comptime head-id [f <- Any] -> String (return f.nodes[0].id))
    (fn :comptime arity [f <- Any] -> Int (return f.nodes.length))

    (console.log "kind:" (kind-of '(+ 1 2)))
    (console.log "head:" (head-id '(+ 1 2)))
    (console.log "arity:" (arity '(+ 1 2)))

    ;; -- an absent field answers nil, it does not raise ---------------------------------------------
    ;;
    ;; A handler branching on shape asks for fields a given kind does not have on every other line, so
    ;; a raising read would make that unwritable. This matches what both BACKENDS already do for the
    ;; same read on a quoted form, which is the parity that matters.

    (fn :comptime has-condition [f <- Any] -> Boolean (return (!= f.condition nil)))
    (console.log "list has :cond?" (has-condition '(+ 1 2)))

    ;; -- it NESTS, and the walk is ordinary member access -------------------------------------------

    (fn :comptime inner-op [f <- Any] -> String (return f.nodes[1].nodes[0].id))
    (console.log "inner op:" (inner-op '(f (> x 10) "big")))

    ;; -- a form can be RETURNED, and stays DATA -----------------------------------------------------
    ;;
    ;; The fold re-wraps an AST result in `quote` rather than dropping it into the tree as code. That
    ;; is the tier boundary: splicing a returned form IS macro expansion, which is `defsyntax`'s job
    ;; (D69), and `:comptime` doing it by accident would collapse two of the three tiers without
    ;; anybody ruling it. So the line below prints `+`, and never 3.

    (fn :comptime pass-form [f <- Any] -> Any (return f))
    (let q (pass-form '(+ 1 2)))
    (console.log "returned kind:" q._type)
    (console.log "still data:" q.nodes[0].id)

    ;; -- literals keep their kinds through the evaluator --------------------------------------------
    ;;
    ;; D51 splits Int from Real, and a form's literals carry that split. `2.5` is a `float-number` and
    ;; `1` is an `integer-number`, in the datum as in the source.

    (fn :comptime nth-kind [f <- Any n <- Int] -> String (return f.nodes[n]._type))
    (console.log "int node:" (nth-kind '(1 2.5) 0))
    (console.log "real node:" (nth-kind '(1 2.5) 1))

    ;; -- what is still REFUSED, pinned in test:diagnostics -----------------------------------------
    ;;
    ;;   (esc '(+ 1 2))  where esc reads `f._parent`  -- LL0099: cyclic, and it would let a handler
    ;;                                                  walk out of its form into the whole program
    ;;   (f n)           where n is a `mut`           -- LL0099: the literal rule is unchanged for
    ;;                                                  everything that is not a constant
    (console.log "done")
)

;; CONFORMANCE guard: `(call f a b)` passes its arguments AS WRITTEN, on both backends.
;;
;; `call_nullary_c.lisp` pins the zero-argument shape -- D1's escape hatch, the only way to invoke a
;; nullary from source. Nothing pinned what happens when arguments are present, and there are two
;; incompatible answers live in the tree, which is why this file exists.
;;
;; THE ANSWER IS D25's APPLICATION FORM. `DesugarAstVisitor.transformCall` rewrites `(call f a b)` into
;; a real `call` node with callee `f` and arguments `a`, `b` -- so it means exactly what `(f a b)` would
;; mean if `f` were a name in head position. Arity is CHECKED, argument types are CHECKED, and a vector
;; argument is ONE argument.
;;
;; The other answer is the runtime shim it replaced, which is still present in both runtimes:
;; `ll_call_dyn` is `ll_call(fn, a->len, a->items)` and the JS shim is
;; `(f, args) => Array.isArray(args) ? f(...args) : f()`. Both SPREAD a vector second argument. Reading
;; either one and concluding that the language spreads is the mistake this file is here to prevent --
;; the desugar sits above them and no source-level `call` reaches that path.
;;
;; The difference is not academic, because the two readings disagree on real code:
;;
;;     (call subtract [7 5])     spread reading: 2      actual: LL0211, 'subtract' expects 2, got 1
;;     (call handler argv)       spread reading: handler(argv[0])   actual: handler(argv)
;;
;; The second line is a dispatch table, and it is the one that matters: a command handler declared
;; `[args <- String[]]` is invoked `(call action argv)` and receives the whole vector, TYPED. Under the
;; spread reading it would have to be `(call action [argv])` and could not be typed at all.
;;
;; A wrong-arity `call` is a compile error rather than a silent truncation, which is the property that
;; makes the dispatch shape safe to build on. It cannot be demonstrated in a passing file; it is pinned
;; separately by `90-diagnostics`.
(
    ;; -- arguments are passed as written ------------------------------------------------------------

    (fn subtract [a <- Int b <- Int] -> Int (return (- a b)))

    ;; NOT commutative, deliberately: `(- 7 5)` is 2 and `(- 5 7)` is -2, so this pins the ORDER as
    ;; well as the arity. A golden of `0` would have been satisfied by an argument swap.
    (console.log "two args: " (call subtract 7 5))

    ;; -- a VECTOR is one argument, not a spread ----------------------------------------------------
    ;;
    ;; The row that distinguishes the two readings. Under the shim's semantics this is `count-of(10)`
    ;; -- a type error at best, a wrong answer at worst. Under D25's it is `count-of([10 20 30])`, and
    ;; the declared `Int[]` parameter type-checks against the argument as written.

    (fn count-of [xs <- Int[]] -> Int (return xs.length))
    (console.log "vector:   " (call count-of [10 20 30]))

    ;; -- zero arguments, the shape `call` exists for -----------------------------------------------

    (fn answer [] -> Int (return 42))
    (console.log "nullary:  " (call answer))

    ;; -- a closure callee takes the same path ------------------------------------------------------

    (let add (fn [a <- Int b <- Int] -> Int (return (+ a b))))
    (console.log "closure:  " (call add 4 5))

    ;; -- THE DISPATCH SHAPE ------------------------------------------------------------------------
    ;;
    ;; A handler stored in a field and invoked with the argument list as a single typed parameter.
    ;; This is what a command table needs, and it is why the D25 reading is the convenient one: the
    ;; handler's `String[]` is a real declared type the checker enforces at the call site.
    ;;
    ;; The field is `Any` because no class in lib/ or examples/ carries a function-TYPED field, so an
    ;; `Any` slot plus `call` is the only shape with evidence behind it. Whether a typed function field
    ;; works is measured separately rather than assumed here.

    (fn greet [args <- String[]] -> String (return (+ "hello " args[0])))

    (defclass Handler
        (mut :ctor action <- Any)
        (fn invoke [args <- String[]] -> Any (
            (let f this.action)
            (return (call f args))
        )))

    (let h (Handler greet))
    (console.log "dispatch: " (h.invoke ["world" "ignored"]))
)

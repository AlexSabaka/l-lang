;; ADVERSARIAL: every form yields a value, and a form that yields NOTHING yields `nil` (D94).
;;
;; "Everything is an expression" was stated in three places -- `language-syntax.md`, `hir-brief.md`,
;; and inside D9, where it is the ARGUMENT for `Void` and `Nil` being one type -- and was true in
;; none of them. Measured: `while`, `for`, `for :each` and `:=` yielded an UNTYPED nil, so the value
;; flowed. `(+ (while …) 1)` passed the type checker and panicked at RUN time on both backends, and
;; `(+ (for :each …) 1)` printed `1` -- a silent wrong answer, which is worse than the panic.
;;
;; Worse still, a C-style `for` in value position emitted C THAT DID NOT COMPILE, while the same loop
;; in statement position was fine. The `:step` was resolved before the `:init`, so the induction
;; variable had not been declared yet and fell back to boxed, while the init declared `int64_t`.
;;
;; This file pins the VALUES. The refusals cannot live here -- a file in this directory has to run --
;; so they are pinned in `test:diagnostics`:
;;
;;   (+ (while …) 1)                 -- LL0204, "Operator '+' is not defined for Nil and Int"
;;   (let x (defclass C …))          -- LL0109 on JS, ELL0106 on C: a declaration is not a value
(
    ;; -- the forms that carry a value ---------------------------------------------------------------

    (let a (if true 1 2))
    (console.log "if:" a)

    (let b (when true :then 10))
    (console.log "when:" b)

    (let c (cond ((> 2 1) 20) (:else 30)))
    (console.log "cond:" c)

    (let d (match 1 { 1 => "one" _ => "other" }))
    (console.log "match:" d)

    (let e (try 40 catch 50))
    (console.log "try:" e)

    ;; A BLOCK yields its last value, and its earlier forms still run for effect.
    (let f ((console.log "block ran") 60))
    (console.log "block:" f)

    ;; -- a `fn` is a value whether or not it has a NAME ---------------------------------------------
    ;;
    ;; The anonymous form always worked on both backends (53 corpus sites bind one). The NAMED form
    ;; emitted a FunctionDeclaration, which is a statement in ESTree -- so C answered the function and
    ;; JS threw a raw Node stack trace out of the compiler. Two spellings of one idea, disagreeing
    ;; across backends. It is coerced to a FunctionExpression now.

    (let g (fn [x <- Int] -> Int (return (+ x 1))))
    (console.log "anon fn:" (g 1))

    (let h (fn nm [x <- Int] -> Int (return (* x 2))))
    (console.log "named fn:" (h 3))

    ;; -- the forms that yield `nil` -- and STILL RUN ------------------------------------------------
    ;;
    ;; The value being nil is not the loop being skipped. Each of these asserts both halves: what the
    ;; form answered, and the effect it had. A lowering that "fixed" the value by dropping the loop
    ;; would pass the first assertion and fail the second.

    (mut i 0)
    (let w (while (< i 3) ((i := (+ i 1)))))
    (console.log "while:" w)
    (console.log "while ran:" i)

    ;; THE REGRESSION GUARD for the invalid C. This exact shape -- a C-style `for` in a `let` init --
    ;; is what failed `cc`. It has to be COMPILED to be tested, so it must live in a running file.
    (let fr (for :init (mut k 0) :cond (< k 3) :step (k := (+ k 1)) :then ((console.log "tick"))))
    (console.log "for:" fr)

    (let xs [1 2 3])
    (let fe (for :each n :from xs :then ((console.log "each" n))))
    (console.log "foreach:" fe)

    (mut z 0)
    (let asg (z := 5))
    (console.log "assign:" asg)
    (console.log "assign ran:" z)

    ;; -- what is NOT ruled here ---------------------------------------------------------------------
    ;;
    ;; A `let` in value position -- `(let x (let y 5))` -- is deliberately untouched. The type
    ;; channel's entry for a VariableNode is not free: it is the BINDING's type, read back by
    ;; `declaredTypeOf` to decide how the binding is declared in C, so typing the node `Nil` would
    ;; declare every nested `let` as Nil. Recorded in roadmap rather than guessed at.
    ;;
    ;; And l-lang has no `break` and no `continue` at all, so "should a loop yield the value a `break`
    ;; carries" is a question that cannot even be asked yet.
    (console.log "done")
)

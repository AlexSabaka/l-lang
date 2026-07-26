;; Modifier ARGUMENTS are adjacency-gated (D68).
;;
;; `:name[args]` -- bracket butted directly against the name -- is a modifier taking arguments.
;; `:name [something]` -- with a space -- is a modifier, followed by a separate bracket that belongs
;; to whatever construct is being declared. Same discriminator the grammar already uses for `arr[i]`
;; against `arr [i]`, and for `HttpMethod:GET` against `(let :ctor x)`.
;;
;; Without the gate the argument list was greedy and simply ate the next `[ … ]`, which broke the two
;; forms below. Both are ordinary; neither was reachable.
(
    ;; A modifier on an ANONYMOUS function, where the parameter list follows immediately with no name
    ;; in between to separate them. This did not parse AT ALL -- the modifier ate `[x <- Int]` and the
    ;; rule then demanded another `[`, reporting `Expecting token of type --> LBracket <-- but found
    ;; --> 'Int' <--` from inside a form that has no second bracket to give it.
    (let double (fn :public [x <- Int] -> Int (* x 2)))
    (console.log "anonymous fn with a modifier:" (double 21))

    ;; The destructuring-let case -- the other form the gate fixes, and the worse of the two -- lives
    ;; in 08 rather than here, because a destructuring declaration has no C lowering (ELL0106) and
    ;; this file is C-pinned.

    ;; The spaced form composes: several modifiers, then the parameter list, and nothing is consumed
    ;; that should not be.
    (let triple (fn :public :internal [x <- Int] -> Int (* x 3)))
    (console.log "two modifiers then params:" (triple 14))

    ;; And a modifier list on a NAMED function still works the way it always did -- this form was
    ;; never broken, because the name stood between the modifiers and the bracket.
    (fn :public quadruple [x <- Int] -> Int (* x 4))
    (console.log "named fn, unchanged:" (quadruple 10))
)

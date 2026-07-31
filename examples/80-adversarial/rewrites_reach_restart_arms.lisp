;; THE OTHER TWO RECORD SHAPES the rewrite descent had to learn -- restart arms and handler clauses.
;;
;; The catch-arm half of this defect is pinned by `rewrites_reach_catch_arms.lisp`, which is graded on
;; both backends. This file exists because `RestartArm` and `HandleClause` are NOT the same shape as
;; `TryCatchFilter` and reach different branches of the descent:
;;
;;     TryCatchFilter  { filter: {name, type},  body: ASTNode  }   <- a record nested in a record
;;     RestartArm      { name: string, params: ASTNode[], body: ASTNode[] }
;;     HandleClause    { condType: string, binder?: ASTNode, body: ASTNode[] }
;;
;; So the catch arm proves a nested record is entered and these two prove an ARRAY-of-nodes inside a
;; record is entered. A descent that handled only the first would leave both of these broken, and both
;; were: `(dbl v)` in a restart arm and in a handler clause were each `LL0210 'dbl' is not defined`
;; while the identical call in the restart-case BODY beside them expanded correctly.
;;
;; SEPARATE FILE BECAUSE THERE IS NO ORACLE. D47's restarts are C-native and JS refuses the construct
;; wholesale with LL0108, so folding these rows into the catch-arm file would have cost that file its
;; JS grading for the rows that do have an oracle. Every value here is hand-derived.
(
    (defclass Alert :extends Error (let :ctor message))
    (defsyntax dbl [e] `(* ~e 2))
    (defsyntax inc [e] `(+ ~e 1))

    ;; 1. THE CONTROL: a macro in the restart-case BODY. This position was always an ordinary child
    ;;    and always worked, so it is what says the fix is about the record shape.
    (fn body-control [] -> Int ((restart-case ((return (dbl 3))) (:sub [v] v))))
    (console.log "restart body:" (body-control))

    ;; 2. A macro in a RESTART ARM -- `body: ASTNode[]` inside a record.
    (fn arm-macro [] -> Int ((restart-case ((signal (Alert "x")) (return -1)) (:sub [v] (dbl v)))))
    (handle ((console.log "restart arm:" (arm-macro)))
        (:on Alert [] (invoke-restart :sub 5)))

    ;; 3. A macro in a HANDLER CLAUSE -- a different record again, and the arm stays plain so the two
    ;;    positions cannot mask each other.
    (fn clause-macro [] -> Int ((restart-case ((signal (Alert "x")) (return -1)) (:sub [v] v))))
    (handle ((console.log "handler clause:" (clause-macro)))
        (:on Alert [] (invoke-restart :sub (dbl 6))))

    ;; 4. BOTH AT ONCE, with different macros, so a cross-wire shows as a wrong number: the clause
    ;;    computes (inc 6) = 7 and the arm doubles it.
    (fn both [] -> Int ((restart-case ((signal (Alert "x")) (return -1)) (:sub [v] (dbl v)))))
    (handle ((console.log "both:" (both)))
        (:on Alert [] (invoke-restart :sub (inc 6))))

    ;; 5. The LOGICAL ALIASES and a FRACTION in a restart arm -- two other rewriting passes, same
    ;;    position, so this is not a macro-only fix.
    (fn other-passes [] -> Any ((restart-case ((signal (Alert "x")) (return "unreached"))
                                   (:sub [v] ((console.log "arm and:" (and true false))
                                              (console.log "arm fraction:" (+ 1/2 1/4))
                                              "done")))))
    (handle ((console.log "other passes:" (other-passes)))
        (:on Alert [] (invoke-restart :sub 0)))
)

;; ADVERSARIAL: a closure declared in a `for`'s `:init` captures the loop's `mut` BY REFERENCE.
;;
;; `03-loops/01_for.lisp` timed out for the whole life of the C backend and `02_more_for_loops.lisp`
;; was refused, and they were one defect. Capture-by-reference was never broken -- `computeCellVars`
;; has always promoted a mutable-captured local to a heap cell, and a closure over a `mut` in an
;; ORDINARY function body has always worked. What failed was REACHING that analysis from a `for`:
;;
;;   1. `collectMutDecls` descended only into `list` blocks while its sibling `collectNestedFreeVars`
;;      descended generically. So the closure was seen, the `mut` beside it was not, and the
;;      intersection of "declared here" and "captured by a nested closure" came out empty.
;;   2. At MODULE scope the analysis ran over `topLevelStmtNodes(...)`, which keeps only
;;      `opaque-stmt | class | expr-stmt | var-decl`. A top-level `for` is in none of those, so the
;;      cell set was computed over ZERO items -- the same "scan at the wrong depth finds nothing and
;;      says nothing" failure D72's annotation registry had already been corrected for.
;;   3. Once cells finally appeared in a `for`, `EmitCirToC`'s `c-for` update slot emitted the target
;;      as a bare `target.cName`, ignoring the `cell` flag that its own `lvalue()` helper honours. A
;;      cell was READ as `(*u_j)` and WRITTEN as `u_j` -- a second copy of one decision, drifted.
;;
;; The env-copy shape it produced, which is what "the loop never advances" looks like in C -- the
;; closure environment receives a COPY of the variable, and the closure then increments the copy:
;;
;;     __e->u_j = u_j;
;;     int64_t u_j = __e->u_j; u_j = u_j + 1;
;;
;; (Written without C block-comment delimiters on purpose: an l-lang comment containing them is
;; re-emitted into a JS block comment by the deprecated backend and closes it early -- LL0101,
;; "the JS backend emitted code that is not valid JavaScript". Recorded in roadmap, Known gaps.)
(
    ;; -- the shape that hung: the loop is driven ENTIRELY by closures over its own `:init` ----------
    ;;
    ;; Neither `:cond` nor `:step` mentions `i`. If the capture is by value, `advance` increments a
    ;; dead copy, `more` never goes false, and this never terminates. Three lines is the whole test.

    (for :init ((mut i 0)
                (fn advance [] (i := (+ i 1)))
                (fn more [] (< i 3)))
         :cond (more)
         :step (advance)
         :then (console.log "driven by closures, i =" i))

    ;; -- and the loop variable is still LIVE afterwards, because `:init` opens the enclosing block --
    ;;
    ;; A cell is heap storage, so this also checks the value survives the loop rather than the
    ;; promotion quietly making a fresh binding per iteration.
    (for :init ((mut k 0) (fn kbump [] (k := (+ k 2))))
         :cond (< k 4)
         :step (kbump)
         :then (console.log "k =" k))

    ;; -- TWO bindings of the SAME NAME in one frame, one captured and one not ----------------------
    ;;
    ;; `cellVars` is keyed by MANGLED NAME, not by binding, so both `j`s below share an entry. The
    ;; second `j` is captured by nobody and does not need a cell; it inherits one from the first. That
    ;; is acceptable -- a needless heap cell is a cost, not a wrong answer -- but ONLY as long as the
    ;; declaration, every read and every write agree. They did not: this exact program emitted C that
    ;; `cc` rejects, which is how the update-slot copy above was found.

    (for :init ((mut j 0) (fn jbump [] (j := (+ j 1))))
         :cond (< j 2) :step (jbump) :then (console.log "captured j =" j))
    (for :init (mut j 0)
         :cond (< j 2) :step (j := (+ j 1)) :then (console.log "plain j =" j))

    ;; -- the same capture INSIDE a function body, which always worked, as the control ---------------
    ;;
    ;; If this ever breaks while the cases above pass, the fix has been made in the wrong place.
    (fn counted [] -> Int (
        (mut n 0)
        (fn tick [] (n := (+ n 1)))
        (tick)
        (tick)
        (return n)))
    (console.log "ordinary function scope:" (counted))

    ;; -- a closure in `:init` that only READS is not promoted, and must still see the updates -------
    (for :init ((mut m 0) (fn peek [] -> Int (return m)))
         :cond (< m 2)
         :step (m := (+ m 1))
         :then (console.log "read-only closure sees" (peek)))
)

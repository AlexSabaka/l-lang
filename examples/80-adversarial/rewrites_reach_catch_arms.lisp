;; NO REWRITING PASS EVER REACHED INSIDE A CATCH ARM. D89's bug, one container over.
;;
;; `mapChildArray`'s own note records the original: a matrix ROW is `ASTNode[]` inside `ASTNode[][]`,
;; not an AST node, so it came back untouched and no desugar ever reached a matrix cell. The very same
;; sentence was true of a catch arm. `TryCatchNode.catch` is `TryCatchFilter[]` and each element is a
;; plain `{filter, body}` RECORD -- not an array, not an AST node -- so the mapper returned it
;; unchanged. Every rewriting visitor in the tree routes through that one function, so *every* rewrite
;; stopped at the arm boundary.
;;
;; THREE INDEPENDENT PASSES, THREE SYMPTOMS, all measured inside a catch arm and all agreeing on both
;; backends -- and every one of them correct in the try BODY beside it, which is an ordinary child:
;;
;;     a `defsyntax` macro   ->  LL0210 '<name>' is not defined
;;     (and a b)             ->  LL0210 'and' is not defined     <- D89's own symptom, verbatim
;;     1/2                   ->  ELL0106 Cannot generate C for 'fraction-number'
;;
;; The third is the worst shape: a raw literal reaching codegen, which is the same class D110 hit when
;; a traversal broke for one commit. Here it was permanent.
;;
;; READING passes were never affected -- `BaseAstTreeWalker` recurses structurally -- which is exactly
;; why `LL0210` gets reported from inside an arm at all. That is D89's "the two halves of the compiler
;; disagreed about whether this had children", unlearned for a second container shape.
;;
;; EVERY ROW IS PAIRED WITH THE SAME FORM IN THE TRY BODY, deliberately: the body rows always worked,
;; so a future regression that breaks both reads as a traversal fault, and one that breaks only the
;; arm reads as this bug returning. Fixing it cost the corpus NOTHING -- 319 passing before and after,
;; because no corpus file had ever written any of these three things inside an arm.
(
    (defsyntax dbl [e] `(* ~e 2))

    ;; -- 1. a MACRO, in the body and in the arm ----------------------------------------------------
    (try ((console.log "body macro:" (dbl 5)) (throw (new ValueError "x")))
      catch e ((console.log "arm macro:" (dbl 6))))

    ;; -- 2. the LOGICAL ALIASES, which are a different rewriting pass -------------------------------
    (try ((console.log "body and:" (and true true)) (throw (new ValueError "x")))
      catch e ((console.log "arm and:" (and true false)) (console.log "arm or:" (or false true))))

    ;; -- 3. a FRACTION LITERAL, which is the DESUGARER, and whose failure reached codegen raw -------
    (try ((console.log "body fraction:" (+ 1/2 1/4)) (throw (new ValueError "x")))
      catch e ((console.log "arm fraction:" (+ 1/2 1/4))))

    ;; -- 4. a FINALLY is an ordinary `ASTNode` child and always worked; it is the control that says
    ;;       the fix is about the RECORD shape and not about protected regions in general.
    (try ((throw (new ValueError "x")))
      catch e ((console.log "arm again:" (dbl 7)))
      finally ((console.log "finally macro:" (dbl 8))))

    ;; -- 5. NESTED: an arm inside an arm. The outer arm is a record whose body contains another try,
    ;;       so this only works if the descent RECURSES rather than going one level.
    (try ((throw (new ValueError "outer")))
      catch e ((try ((throw (new ValueError "inner")))
                 catch e2 ((console.log "nested arm macro:" (dbl 9))))))
)

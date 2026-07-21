;; D47 clause semantics in ONE handle form: `ll_is_type` matches nominally through `:extends`, so a
;; ParseError satisfies an `:on AppError` clause. Clauses are tried in SOURCE order (first-written gets
;; first crack) and a handler that RETURNS declines TO THE NEXT MATCHING CLAUSE of the same form before
;; the walk moves outward -- D47's "decline -> next handler". C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: the AppError clause matches first (parent of ParseError) and declines; the
;; ParseError clause is then tried and also declines; no outer frame remains -> signal yields nil.
;; Expected: parent clause, child clause, null.
(
    (defclass AppError :extends Error (let :ctor message))
    (defclass ParseError :extends AppError (let :ctor message))
    (handle
        ((console.log (signal (ParseError "p"))))
        (:on AppError [] (console.log "parent clause"))
        (:on ParseError [] (console.log "child clause")))
)

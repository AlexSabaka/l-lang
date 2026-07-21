;; A name that exists nowhere, used inside a CATCH body. Must report LL0210 -- the body of a catch is
;; ordinary code and gets the same unresolved-name check as any other. It went unreported until the AST
;; walkers learned to descend into record-shaped fields (`catch` clauses carry no `_type`), so a typo
;; here reached run time on JS and `cc` on the C backend. Negative test.
(
    (fn f [] (try ((console.log "ok")) catch e ((bogus-fn e))))
    (f)
)

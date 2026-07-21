;; The D47 sibling again: an undefined name inside a `restart-case` ARM body. Must report LL0210 (the
;; arm's params are legitimate bindings and must NOT be reported). Negative test.
(
    (fn f [] -> Int (restart-case (invoke-restart :go 1) (:go [v] (bogus-fn v))))
    (console.log (f))
)

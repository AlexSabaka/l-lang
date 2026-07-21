;; The D47 sibling of the catch case: an undefined name inside a `handle` clause body. Must report
;; LL0210 (the clause binder `c` itself is a legitimate binding and must NOT be reported). Negative test.
(
    (defclass Alert :extends Error (let :ctor message))
    (handle
        ((signal (Alert "x")))
        (:on Alert [c] (bogus-fn c)))
)

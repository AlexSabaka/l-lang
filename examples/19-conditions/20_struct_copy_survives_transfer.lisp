;; D11 value semantics across a raw control transfer (a D47 edge the design brief flagged): a struct copy
;; taken BEFORE a restart-case must stay consistent when the body mutates the original and then longjmps
;; to the restart. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D11 + D47: `(let snapshot p)` copies the struct by value, so the body's `(p.x := 42)`
;; cannot be visible through it, and the invoke-restart transfer does not disturb the copy.
;; Expected: 1 then 7.
(
    (defstruct pt (let :ctor x <- Int 0))
    (fn f [] -> Int (
        (mut p (pt 1))
        (let snapshot p)
        (restart-case
            ((p.x := 42)
             (invoke-restart :go 7))
            (:go [v] v))
        (console.log (snapshot.x))
        (return 7)
    ))
    (console.log (f))
)

;; A struct passed to an INTERFACE-typed parameter is STILL passed BY VALUE (D11).
;;
;; The callee's copy-on-entry is the load-bearing D11 copy for a call. It was skipped on JS when the
;; parameter's declared type was an interface (provablyNotAStruct returned true for `interface`), so the
;; callee ALIASED the caller's struct; C copied on the concrete ctype. Same divergence class as the
;; store-copy (05); the fix is the same shared, corrected predicate.
;;
;; `use` gets its own copy of `orig`. `c.bump` mutates that copy, not `orig`.
(
    (definterface ICounter
        (fn bump [] -> Int)
    )
    (defstruct Counter :implements ICounter
        (mut :ctor n <- Int 0)
        (fn bump [] -> Int (
            (this.n := (+ this.n 1))
            (return this.n)
        ))
    )
    (mut orig (Counter 10))
    (fn use [c <- ICounter] -> Int (return (c.bump)))  ;; c is a by-value copy, even as an interface
    (mut r (use orig))                                  ;; the copy's n: 10 -> 11
    (console.log r orig.n)                              ;; orig is untouched: still 10
)

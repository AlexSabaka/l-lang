;; D28 rest patterns: `[a ...rest]` matches an array of AT LEAST the fixed length and binds the tail
;; as a slice. The head bindings are ordinary element bindings; the rest is a binding, not a test.
;;
;; This is the corpus's only rest-pattern program, and it exists to fence the two backends against each
;; other: the JS backend binds `rest` to `slice(n)`, while the C backend declared the name and left it
;; nil (its bound-name walk looked for a field the rest node does not have). A golden that reads the
;; rest's CONTENTS -- not just its length -- is what makes that divergence visible.
(
    (fn describe [xs] (
        (match xs {
            [a ...rest]   => f"head {(a)} tail-len {(rest.length)} tail0 {(rest[0])}"
            _             => "no match"
        })
    ))

    (fn pair-then-rest [xs] (
        (match xs {
            [a b ...rest] => f"a {(a)} b {(b)} rest-len {(rest.length)}"
            _             => "too short"
        })
    ))

    (console.log (describe [1 2 3]))
    (console.log (pair-then-rest [10 20 30 40]))
    (console.log (pair-then-rest [10 20]))
    (console.log (pair-then-rest [10]))
)

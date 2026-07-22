;; format.lisp -- presentation.
;;
;; A plain FILE module, deliberately outside the `geometry` package: the program spans
;; a package boundary and a file boundary, and both are crossed the same way -- import.
(
    (import "std/core/string")
    ;; `Number` (= Int | Real) is declared in std/types, and an annotation naming a type that does
    ;; not exist turns CHECKING OFF for the declaration rather than merely losing information --
    ;; which is why this was a live LL0231 in a `library` file, where `test:type-errors` excludes it
    ;; from the corpus count and nothing could see it. Importing std/types does NOT cost the C
    ;; backend anything: imported bodies lower ON DEMAND, and this module calls none of its
    ;; functions -- only its type.
    (import "std/core/types")

    ;; NOT exported: how wide a column is drawn is nobody else's business.
    (fn pad-right [s <- String n <- Int] -> String
        (mut out s)
        (while (< (strlen out) n)
            (out := (+ out " ")))
        (return out))

    (fn banner [title <- String] -> String
        (return (+ "=== " (upcase title) " ===")))

    (fn row [label <- String dims <- String size <- Number diag <- Number] -> String
        (return (+ (pad-right label 8)
                   (pad-right dims 8)
                   (pad-right '"area={(size)}" 12)
                   '"diag={(diag)}")))

    (fn total-line [n <- Int] -> String
        (return '"total rect area: {(n)}"))

    (export banner row total-line)
)

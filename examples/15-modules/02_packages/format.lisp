;; format.lisp -- presentation.
;;
;; A plain FILE module, deliberately outside the `geometry` package: the program spans
;; a package boundary and a file boundary, and both are crossed the same way -- import.
(
    (import "std/string")

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

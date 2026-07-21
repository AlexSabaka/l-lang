;; Library half A. Its PRIVATE `TAG` and PRIVATE `decorate` deliberately share their names with
;; beta.lisp's. Both are module-private (absent from `export`), which under D20 is legal and means
;; the two are different bindings that happen to be spelled the same.
(
  (let TAG "alpha")

  (fn decorate [s <- String] -> String (return (+ "[" s "]")))

  (fn alpha-label [] -> String (return (decorate (+ "from " TAG))))

  (export alpha-label)
)

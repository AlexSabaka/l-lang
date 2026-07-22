;; Library half. The function must live in ANOTHER module: an import is inlined under a mangled
;; binding, and the formatter read that binding's name.
(
  (fn double-it [x <- Int] -> Int (* x 2))
  (export double-it)
)

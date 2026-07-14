(
  ;; A file written the conventional way: every form inside ONE outer list.
  ;; That outer list is a BLOCK (D17). Loaded as a single cell, `a` and `b` would be
  ;; block-scoped and invisible at the next prompt. `.load` must unwrap it.
  (let a 1)
  (let b 2)
)

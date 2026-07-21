;; Library half A. `label` and `apply-fn` are module-PRIVATE and share their names with beta.lisp's.
;; `label` is passed as a VALUE and never called by name, which is the path that resolves through
;; `functionValue` / the boxed adapter rather than through a direct call.
(
  (fn label [s <- String] -> String (return (+ "alpha:" s)))

  (fn apply-fn [f s] (return (f s)))

  (fn alpha-run [] -> String (return (apply-fn label "x")))

  (export alpha-run)
)

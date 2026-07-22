;; The provider for `import_export_aliases/main.lisp`. Three shapes, one per alias case.
(
    ;; Exported under its own name.
    (fn plain-name [] -> Int (return 1))

    ;; Exported under a DIFFERENT name. The module offers `renamed-by-export`; `internal-name` is
    ;; this module's business and does not cross.
    (fn internal-name [] -> Int (return 2))

    ;; A class, to prove an alias is not a function-only affair -- it binds the SYMBOL, whatever it is.
    (defclass Widget (fn describe [] -> String (return "a widget")))

    (export plain-name)
    (export internal-name :as renamed-by-export)
    (export Widget)
)

;; Library half of `display_imported_class_tag`. The class must live in ANOTHER module: that is the
;; whole point -- an import is INLINED under a mangled JS name, and the display formatter was reading
;; the name off the wrong object and getting the mangler's.
(
  (defstruct Money
    (let :ctor amount <- Int 0)
    (let :ctor currency <- String "")
  )
  (export Money)
)

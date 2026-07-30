(
  (import "std/core/string")

  (fn print [msg <- String ...args <- Any[]] -> Void
    (console.log (format-args msg args)))

  (fn prn [x] (console.log x))
  
  ;; The guard compares `typeof window` to the STRING "undefined", and must.
  ;;
  ;; It used to read `(&& (typeof window) (!= window nil))`. Two problems, and either one is fatal
  ;; outside a browser: `typeof window` yields the string "undefined", which is TRUTHY, so the `&&`
  ;; always proceeded -- and `(!= window nil)` then TOUCHES an undeclared `window`, which is a
  ;; `alert` WAS HERE AND IS GONE. It reached for `typeof window` to sniff a browser, and `typeof`
  ;; has no C lowering -- so `(import "std/io")` plus `(alert "x")` was
  ;; `ELL0106 Cannot generate C for 'special:typeof'`, reported INSIDE this library file rather than
  ;; at the caller. A refusal by gap rather than by ruling, hidden in the most-imported I/O module,
  ;; with zero call sites anywhere to reveal it. CLAUDE.md's claim that the reference backend declines
  ;; nothing "because nobody built it" was false while this existed.
  ;;
  ;; Not replaced. A browser dialog is not something `std/io` can promise portably, and the JS backend
  ;; that could host it is deprecated (D66).

  (export print prn)
)
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
  ;; ReferenceError, not a false. `typeof` is the only operator that may name a binding that does not
  ;; exist; that is the entire reason to reach for it here.
  (fn alert [msg]
    (if (!= (typeof window) "undefined")
      (window.alert msg)
      (console.log "ALERT:" msg)))

  (export print prn alert)
)
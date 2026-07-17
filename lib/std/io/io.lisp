(
  (import "std/seq")

  (fn print [msg <- String ...args <- Any[]] -> Void
    ;; A `mut` local, not the parameter: a parameter is bound once (D10). Interpolate `{index}` in a copy.
    (mut out <- String msg)
    (for :each arg :from (zip args (range 0 args.length 1)) :then (
      (match arg {
        [value index] => (out := (out.replace (+ "{" index "}") (+ "" value)))
      })
    ))
    (console.log out)
  )

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
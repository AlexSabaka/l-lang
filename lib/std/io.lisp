(
  (import "std/enumerable")

  (fn print [msg <- String ...args <- Any[]] -> Void
    (for :each arg :from (zip args (range 0 args.length 1)) :then (
      (match arg {
        [value index] => (msg := (msg.replace (+ "{" index "}") (+ "" value)))
      })
    ))
    (console.log msg)
  )

  (fn prn [x] (console.log x))
  
  (fn alert [msg] 
    (if (&& (typeof window) (!= window nil)) 
      (window.alert msg)
      (console.log "ALERT:" msg)))

  (export print prn alert)
)
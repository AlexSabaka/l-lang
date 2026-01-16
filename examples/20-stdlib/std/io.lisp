(namespace std.io
  (import "enumerable.lisp")

  (fn print [msg <- String ...args <- Any[]] -> Void
    (for :each arg :from (zip args (range 0 args.length 1)) :then (
      (match arg {
        [value index] => (msg := (msg.replace (+ "{" index "}") (value.toString)))
      })
    ))
    (console.log msg)
  )
)
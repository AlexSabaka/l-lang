(namespace std.io
  (fn print [msg <- String ...args <- Any[]] -> Void
    (js:console.log msg)
  ) 
)
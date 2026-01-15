(
  (defmodifier memoized [] 
    (let lookup-table {})
    (return (fn [fn <- (fn [...Any] -> Any) ...args <- Any] -> Any
        (let args-hash 
          (args.reduce 
            (fn [x a] 
              (+ a x)) args.length))
        (if (lookup-table.includes args-hash)
          (return lookup-table[args-hash])
          (
            (let result (fn ...args))
            (lookup-table[args-hash] := result)
            (return result)
          )
        )
      )
    )
  )


  (fn :memoized fib [n <- Int] -> Int
    (match n {
      0 => 1
      1 => 1
      _ => (+ (fib (- n 1))
              (fib (- n 2)))
    })
  )
)
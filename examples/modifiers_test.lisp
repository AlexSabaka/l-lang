(
  ;; Test arbitrary modifiers
  (fn :memoized factorial [n <- Int]
    (if (<= n 1)
        1
        (* n (factorial (- n 1)))))

  ;; Test custom modifier with arguments
  (fn :cached [size 100] fib [n <- Int]
    (if (<= n 1)
        1
        (+ (fib (- n 1)) (fib (- n 2)))))

  ;; Test built-in modifiers still work
  (fn :public :comptime add [a <- Int, b <- Int] (+ a b))

  (let result (factorial 5))
  (console.log "factorial(5) =" result)
)
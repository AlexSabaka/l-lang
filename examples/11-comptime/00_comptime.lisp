(
  (let :comptime x (+ 10 20))
  (console.log "Comptime constant x:" x)

  (fn :comptime factorial [n <- Int]
    (if (<= n 1)
        1
        (* n (factorial (- n 1)))))

  (let fact5 (factorial 5))
  (console.log "Comptime factorial(5):" fact5)

  (fn :comptime add [a <- Int b <- Int] (+ a b))

  (let sum (add 5 7))
  (console.log "Comptime add(5, 7):" sum)

  (let y 10)
  ;; (let :comptime z (+ y 5))
)
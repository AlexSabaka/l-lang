(

  ;; TODO: Something should be done with functional pattern matching,
  ;; i.e. when matching by criteria match x { mod 3 is 0 => ... }
  (fn fizz-buzz [n <- Number] -> boolean (return
    js'((n % 3 === 0 && n % 5 === 0) ? "fizz-buzz" : (n % 3 === 0) ? "fizz" : (n % 5 === 0) ? "buzz" : "none")
  ))

  (fn ƒ [n <- Number] -> Number (return
    (match (std.math.abs n) {
      0 => 1
      1 => 1
      a => (+ (ƒ (- a 1))
              (ƒ (- a 2)))
    })
  ))

  (fn for-each [list f] (
    (when (empty list) return)
    (f (head list))
    (for-each (tail list) f)
  ))

  (let *test-cases* [0 1 3 5 9 11 15 21 31 33])

  (for-each
    *test-cases*
    fn [x] (std.console.log '"fizz-buzz[{(x)}] is {(fizz-buzz x)}")
  )


  (for-each
    *test-cases*
    fn [x] (
      (call std.console.time)
      (std.console.log '"{(x)}-th\tFibonacci number is {(ƒ x)}")
      (call std.console.timeEnd)
    )
  )

  (std.console.log "Tests passed. Now input any integer n:")
  (let n (Number (call std.console.read)))
  (std.console.log '"Fib[{(n)}] is {(ƒ n)}")
)
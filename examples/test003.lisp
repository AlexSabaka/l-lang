(
  (import { sin cos } from std.math)

  (try (Number "abc")
   catch e :of Error1 (std.console.log e)
   catch e :of Error2 (std.console.log e)
   catch e :of Error3 (std.console.log e)
   catch e :of Error4 (std.console.log e)
   finally (std.console.log "finally"))

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

  (let *test-cases* [0 1 3 5 9 11 15 21 29 31])
  (for-each
    *test-cases*
    fn [x] (std.console.log '"{(x)}-th\tFibonacci number is {(ƒ x)}")
  )

  (std.console.log "Tests passed. Now input any integer n:")
  (let n (Number (call std.console.read)))
  (std.console.log '"Fib[{(n)}] is {(ƒ n)}")
)
(
  (fn for-each [list f] (
    (when (empty list) return)
    (f (head list))
    (for-each (tail list) f)
  ))

  (let *test-cases* [0 1 3 5 9 11 15 21 31 33])

  (for-each
    *test-cases*
    fn [x] (std.console.log '"case {(x)}")
  )
)
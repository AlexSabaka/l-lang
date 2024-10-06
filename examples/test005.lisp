(
    (let x '(
        (let :nullable msg <- string "Hello, world!")
        (std.console.log msg)
    ))
    (let yy 120)
    (let v (/ (std.math.log (+ yy 1000))
              (std.math.sqrt yy)
              0.001))
    (std.console.log v)
    (eval x)
)
(
    (let expression '(
        (let :nullable msg <- string "Hello, world!")
        (std.console.log msg)
    ))
    (let value (Number (std.console.read "Enter a number: ")))
    (let v (/ (std.math.log (std.math.abs value))
              (std.math.sqrt (std.math.abs value))))
    (std.console.log v)
    (eval expression)
)
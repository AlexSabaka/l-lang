(
    (std.process.exit 0)

    (definterface ITest
        (let value 10)
        (match x { 1 => 0 })
        ;@ +link lib=test.so entry=test
        (fn :extern test [a <- Number] (return 0))
        (fn test [a <- Number] (return (* a this.value)))
    )

    (mut variable-without-value)

    (try (throw "error"))

    (try (throw "error")
     catch (return 1)
     catch (return 2)
     finally (3)
    )
)
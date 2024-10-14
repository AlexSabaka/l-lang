(
    (std.process.exit 0)

    (import "")

    (import { } from "test.so")

    (import { test } from "")

    (when)

    (cond
        (A B)
        (C D)
        (E B))
    

    ;@ +link lib=test.so entry=test
    (fn :extern test [a :ref <- Number] (return 0))

    (definterface ITest
        (let value 10)
        (match x { 1 => 0})
        (fn test [a <- Number] (return (* a this.value))))
    

    (mut fraction-with-zero-denominator 1/0)

    (let variable-without-value)

    (try (throw "error"))

    (try   ()
     catch (return 1))

    (catch (return 2))
    (finally (3)))

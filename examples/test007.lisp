(
    (import "test007.import.lisp")

    (std.process.exit 0)

    (mut fraction-with-zero-denominator 1/0)

    (let variable-without-value)

    (try (throw "error"))

    (try   ()
     catch (return 1))

    (try "something"
        (catch (return 2))
        (finally (3))))

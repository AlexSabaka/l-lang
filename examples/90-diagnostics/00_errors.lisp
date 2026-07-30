(
    (fn risky-business [] (
        (throw "Something went wrong")
    ))

    ;; LL0002: Fraction denominator cannot be zero
    (let bad-math 1/0)

    ;; LL0006: Constant variable must have initializer
    (let uninitialized-const)

    ;; LL0007 WAS HERE. `(try e)` with neither catch nor finally used to be refused; D110 makes it the
    ;; OPTIONAL TRY -- the block's value, or nil if it threw, typed `T?`. The rule is retired rather
    ;; than re-aimed, because with the bare form legal there is no remaining shape of `try` that is
    ;; structurally invalid. The line that used to sit here is now ordinary, working code.
)
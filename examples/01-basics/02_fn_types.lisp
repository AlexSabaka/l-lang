(
    (fn is-null [x <- any] -> boolean
        (if (== x none)
            (return true))
        (return false))

    (fn n-th [a <- Array<any> n <- Number] -> any (return a[n]))
)
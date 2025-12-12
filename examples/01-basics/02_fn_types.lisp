(
    (fn is-null [x <- any] -> boolean
        (if (== x none)
            (return true))
        (return false))

    (fn n-th [a <- Array<any> n <- Number] -> any (return a[n]))

    (console.log "is-null nil (should be true):" (is-null nil))
    (console.log "2nd element is (should be 3):" (n-th [1 2 3 4 5] 2))
)
(
    (fn is-null [x <- Any] -> Boolean
        (if (== x nil)
            (return #t))
        (return #f))

    (fn n-th [a <- Int[] n <- Int] -> Real
        (return a[n])
    )

    (console.log "is-null nil (should be true):" (is-null nil))
    (console.log "is-null 42 (should be false):" (is-null 42))

    (let array [1 2 3 4 5])
    (console.log "2nd element is (should be 3):" (n-th array 2))
)
(console.log "Type of is-null:" (type "is-null"))
(console.log "Type of n-th:" (type "n-th"))

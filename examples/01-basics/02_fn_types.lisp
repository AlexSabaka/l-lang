(
    (fn :operator <- [lhs <- Ref rhs <- Ref] -> Monad<Ref> (
        (when (Ref.null lhs)
              (lhs = rhs))
    ))
    (fn is-null [x <- any] -> boolean (if (== x none)
        (return true)
        (return false)
    ))
    (fn n-th [a <- Array<any> n <- Number] -> any (return a[n]))
)
(
    (fn :operator <- [lhs <- Ref rhs <- Ref] -> Monad<Ref> (
        (when (Ref.null lhs)
              (lhs := rhs))
    ))
    (fn is-null [x <- any] -> boolean (if (== x null)
        (return true)
        (return false)
    ))
)
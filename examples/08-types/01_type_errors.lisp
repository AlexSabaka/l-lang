;; A NEGATIVE test: every call below is a type error, and the compiler must REFUSE it.
;;
;; These two lines were the tail of 00_primitives.lisp, under comments that said "Shouldn't compile
;; because of type mismatch". They compiled. The golden recorded their output -- "23" and "Help me!"
;; -- as though it were correct, so the file asserted the exact bug it was written to warn about.
;;
;; The type checker could not see them because a call ARGUMENT was invisible to it (the P6 guard).
;; Now it can, and this asserts the CODES rather than an output that should never have existed.
(
    (fn add-integers [a <- Int b <- Int] -> Int (+ a b))
    (fn concat-strings [a <- String b <- Any] -> String '"{(a)}{(b)}")

    ;; Int where a String is declared.
    (console.log (concat-strings 2 3))

    ;; String where an Int is declared -- twice.
    (console.log (add-integers "Help " "me!"))
)

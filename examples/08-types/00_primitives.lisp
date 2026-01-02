(
    ;; This function adds two integers
    (fn add-integers [a <- Int b <- Int] -> Int (+ a b))

    ;; This function concatenates two strings
    (fn concat-strings [a <- String b <- Any] -> String '"{(a)}{(b)}")

    ;; No errors here
    (console.log (concat-strings "Hello, " "world!"))
    (console.log (concat-strings "Hello, " 42))

    ;; Or here
    (console.log (add-integers 5 3))

    ;; Shouldn't compile because of type mismatch
    ;; Given Int instead of String
    (console.log (concat-strings 2 3))

    ;; Shouldn't compile because of type mismatch
    ;; Given String instead of Int
    (console.log (add-integers "Help " "me!"))
)
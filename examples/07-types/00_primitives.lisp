(
    ;; This function adds two integers
    (fn add-integers [a <- Int b <- Int] -> Int (+ a b))

    ;; This function concatenates two strings
    (fn concat-strings [a <- String b <- Any] -> String f"{(a)}{(b)}")

    ;; No errors here
    (console.log (concat-strings "Hello, " "world!"))
    (console.log (concat-strings "Hello, " 42))

    ;; Or here
    (console.log (add-integers 5 3))

    ;; The two calls that "shouldn't compile" used to live here -- and they DID compile. This file's
    ;; golden recorded their output ("23", "Help me!") as if it were the right answer. They now live
    ;; in 01_type_errors.lisp, which asserts the compiler REFUSES them. See P6.
)

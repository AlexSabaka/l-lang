(
    ;; 1. Standard Function
    (fn add [a b] (return (+ a b)))

    ;; 2. Recursive Function (Factorial)
    (fn factorial [n <- Int] -> Int (
        (if (<= n 1)
            (return 1)
            (return (* n (factorial (- n 1)))))
    ))

    ;; 3. When Statement (One-liner logic)
    (fn check-status [code <- Int] (
        (return (when (== code 200) :then "OK"))
    ))

    ;; 4. While Loop
    (mut i 5)
    (console.log "Countdown:")
    (while (> i 0) (
        (console.log i)
        (i := (- i 1))
    ))

    (console.log f"Factorial of 5: {(factorial 5)}")
    (console.log f"Status 200 is: {(check-status 200)}")
)
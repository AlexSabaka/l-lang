(
    (fn get-grade [score <- Int]
        (cond
            ((>= score 90) (return "A"))
            ((>= score 80) (return "B"))
            ((>= score 70) (return "C"))
            (true          (return "F")) ;; Default case
        )
    )

    (console.log '"95 is: {(get-grade 95)}")
    (console.log '"85 is: {(get-grade 85)}")
    (console.log '"75 is: {(get-grade 75)}")
    (console.log '"50 is: {(get-grade 50)}")
)
(
    (fn get-grade [score <- Int]
        (cond
            ((>= score 90) (return "A"))
            ((>= score 80) (return "B"))
            ((>= score 70) (return "C"))
            (:else         (return "F"))
        )
    )

    (console.log f"95 is: {(get-grade 95)}")
    (console.log f"85 is: {(get-grade 85)}")
    (console.log f"75 is: {(get-grade 75)}")
    (console.log f"50 is: {(get-grade 50)}")
)
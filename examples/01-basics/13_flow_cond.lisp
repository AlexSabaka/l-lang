(
    (fn get-grade [score]
        (cond
            ((>= score 90) "A")
            ((>= score 80) "B")
            ((>= score 70) "C")
            (true          "F") ;; Default case
        )
    )

    (std.console.log '"95 is: {(get-grade 95)}")
    (std.console.log '"85 is: {(get-grade 85)}")
    (std.console.log '"75 is: {(get-grade 75)}")
    (std.console.log '"50 is: {(get-grade 50)}")
)
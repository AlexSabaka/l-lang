(
    (fn describe-age [age] (
        (match age {
            0  => "Unborn"
            18 => "Legal Adult"
            30 => "Back pain starts"
            _  => "Just existing"
        })
    ))

    (fn analyze-vector [vec] (
        (match vec {
            [1 2 3] => "Basic count"
            [1 _ _] => "Starts with one"
            []      => "Empty"
            _       => "Unknown vector"
        })
    ))

    (console.log (describe-age 30))
    (console.log (analyze-vector [1 9 9])) ;; Should match "Starts with one"
)
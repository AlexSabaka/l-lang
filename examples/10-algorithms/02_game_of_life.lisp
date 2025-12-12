(
    (fn count-neighbors [grid x y] (
        (mut count 0)
        (let offsets [-1 0 1])
        
        (for (let dy :of offsets) (
            (for (let dx :of offsets) (
                (if (not (and (== dx 0) (== dy 0))) (
                    ;; Logic to check bounds and add to count
                    ;; Simplified for brevity: assuming 3x3 grid without bounds check error
                    (if (== grid[(+ y dy), (+ x dx)] 1)
                        (count := (+ count 1))
                    )
                ))
            ))
        ))
        (return count)
    ))

    (fn next-gen [grid] (
        ;; Create new empty 3x3 matrix
        (let new-grid [0,0,0 | 0,0,0 | 0,0,0])
        
        (mut y 0)
        (while (< y 3) (
            (mut x 0)
            (while (< x 3) (
                (let n (count-neighbors grid x y))
                (let cell grid[y, x])

                ;; Rules: 
                ;; 1. Underpopulation (< 2) -> dies
                ;; 2. Survival (2 or 3) -> lives
                ;; 3. Overpopulation (> 3) -> dies
                ;; 4. Reproduction (== 3) -> born
                
                (if (== cell 1)
                    (if (or (== n 2) (== n 3)) (new-grid[y, x] := 1))
                    (if (== n 3) (new-grid[y, x] := 1))
                )
                (x := (+ x 1))
            ))
            (y := (+ y 1))
        ))
        (return new-grid)
    ))

    ;; Blinker pattern
    (let gen0 
        [ 0, 1, 0
        | 0, 1, 0
        | 0, 1, 0 ])

    (console.log "Generation 0:" gen0)
    (let gen1 (next-gen gen0))
    (console.log "Generation 1 (Should be horizontal):" gen1)
)
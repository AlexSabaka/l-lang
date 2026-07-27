;; Conway's Game of Life, one generation of a blinker.
;;
;; The bounds check in `count-neighbors` is the whole point of the example being here. Without it,
;; `grid[(+ y dy), (+ x dx)]` reads index -1 at the top row and the program dies on
;; `RangeError: IndexOutOfRange: -1 (length 3)` -- the compiler's own emitted bounds check firing,
;; correctly, on an algorithm that never wrote one. The file used to carry a comment saying "simplified
;; for brevity: assuming 3x3 grid without bounds check error", which is not a simplification; it is
;; the bug the runtime then reported.
(
    (fn count-neighbors [grid x y] (
        (mut count 0)
        (let offsets [-1 0 1])

        (for :each dy :from offsets :then (
            (for :each dx :from offsets :then (
                (let ny (+ y dy))
                (let nx (+ x dx))
                ;; ONE flat condition, and the order inside it matters: `and` short-circuits, so the
                ;; bounds tests run BEFORE the indexer that depends on them. Written as nested ifs the
                ;; same logic reads the grid first and traps.
                (if (and (not (and (== dx 0) (== dy 0)))
                         (>= ny 0) (< ny 3)
                         (>= nx 0) (< nx 3)
                         (== grid[ny, nx] 1))
                    (count := (+ count 1)))
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
                
                ;; Two FLAT ifs rather than an if nested in an if's branches. Same rules, and it stays
                ;; clear of the parked nested-`if` defect (roadmap, Known gaps) that a three-argument
                ;; `if` with conditional leaves has bitten before.
                (if (and (== cell 1) (or (== n 2) (== n 3))) (new-grid[y, x] := 1))
                (if (and (== cell 0) (== n 3))              (new-grid[y, x] := 1))
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
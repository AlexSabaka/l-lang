;; Breadth-first search over a grid maze.
;;
;; The interesting part of this example is not the algorithm -- it is that D9 makes the nil-check
;; MANDATORY. `queue.shift` answers `Point?`, because a queue can be empty, and reading `.x` off that
;; without checking is `LL0205 'current' is possibly nil (Point?)`. The loop condition
;; `(> queue.length 0)` proves the queue is non-empty to a HUMAN, and the checker does not read proofs
;; -- so the check is written out. `(!= current nil)` is what discharges it (D9); inside that branch
;; `current` is a plain `Point`.
(
    ;; 0 = Empty, 1 = Wall, 9 = Goal
    (let grid
        [ 0  0  0  1  0
        | 1  1  0  1  0
        | 0  0  0  0  0
        | 0  1  1  1  0
        | 0  0  0  1  9 ])

    ;; Neighbors as (dx dy): Down, Up, Right, Left. The order fixes the visiting order below.
    (let moves [ [0 1] [0 -1] [1 0] [-1 0] ])

    (defstruct Point
        (let :public x 0)
        (let :public y 0))

    (fn solve-maze []
        (let queue [(new Point)]) ;; Start at 0,0
        (let visited { :"0,0" true })

        (while (> queue.length 0) (
            (let current (queue.shift 0))

            ;; D9's forced unwrap. Not defensive programming -- the program does not COMPILE without it.
            (if (!= current nil) (
                ;; Check goal (value 9)
                (if (== grid[current.y, current.x] 9)
                    (return '"Found goal at {(current.x)}, {(current.y)}")
                    (console.log '"Visiting {(current.x)}, {(current.y)}"))

                (for :each m :from moves :then (
                    (let next-x (+ current.x m[0]))
                    (let next-y (+ current.y m[1]))
                    (let key '"{(next-x)},{(next-y)}")

                    ;; Check bounds and walls.
                    ;;
                    ;; `(get visited key)` and not `visited[key]`: the INDEXER is partial and raises
                    ;; `KeyError` on a key that was never written, which is every unvisited cell. The
                    ;; total accessor answers nil instead, which is the question being asked here.
                    (if (&& (>= next-x 0) (< next-x 5)
                            (>= next-y 0) (< next-y 5)
                            (== (get visited key) nil))
                        ;; This is a way around how currently && operator and alike are treated
                        (if (!= grid[next-y, next-x] 1) (
                            (visited[key] := true)
                            (queue.push (new Point next-x next-y))
                        ))
                    )

                ))
            ))
        ))
        (return "No path found")
    )

    (console.log (solve-maze))
)

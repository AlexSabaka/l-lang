(
    ;; 0 = Empty, 1 = Wall, 9 = Goal
    (let grid 
        [ 0  0  0  1  0
        | 1  1  0  1  0
        | 0  0  0  0  0
        | 0  1  1  1  0
        | 0  0  0  1  9 ])

    ;; Neighbors: Up, Down, Left, Right
    (let moves [ [0 1] [0 -1] [1 0] [-1 0] ])

    (defstruct Point
        (let :public x 0)
        (let :public y 0))

    (fn solve-maze []
        (let queue [(new Point)]) ;; Start at 0,0
        (let visited { :"0,0" true })
        
        (while (> queue.length 0) (
            (let current (queue.shift 0))

            ;; Check goal (value 9)
            (if (== grid[current.y, current.x] 9)
                (return '"Found goal at {(current.x)}, {(current.y)}")
                (console.log '"Visiting {(current.x)}, {(current.y)}"))

            (for :each m :from moves :then (
                (let next-x (+ current.x m[0]))
                (let next-y (+ current.y m[1]))
                (let key '"{(next-x)},{(next-y)}")

                (console.log key)
                (console.log visited)
                (console.log queue)
                (console.log next-x next-y)
                ;; Check bounds and walls
                (if (&& (>= next-x 0) (< next-x 5)
                        (>= next-y 0) (< next-y 5)
                        (!  visited[key]))
                    ;; This is a way around how currently && operator and alike are treated
                    (if (!= grid[next-y, next-x] 1) (
                        (visited[key] := true)
                        (queue.push (new Point next-x next-y))
                    ))
                )

            ))
        ))
        (return "No path found")
    )

    (console.log (solve-maze))
)
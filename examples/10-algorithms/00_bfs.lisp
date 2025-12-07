(
    ;; 0 = Empty, 1 = Wall, 9 = Goal
    (let grid 
        [ 0, 0, 0, 1, 0
        | 1, 1, 0, 1, 0
        | 0, 0, 0, 0, 0
        | 0, 1, 1, 1, 0
        | 0, 0, 0, 1, 9 ])

    (defstruct Point
        (let :public x 0)
        (let :public y 0))

    (fn solve-maze [] (
        (let queue [(new Point)]) ;; Start at 0,0
        (let visited { "0,0": true })
        
        (while (> queue.length 0) (
            (let current (queue.shift)) ;; Assuming std shim for array.shift()

            ;; Check goal (value 9)
            (if (== grid[current.y, current.x] 9)
                (return '"Found goal at {(current.x)}, {(current.y)}")
                (std.console.log '"Visiting {(current.x)}, {(current.y)}"))

            ;; Neighbors: Up, Down, Left, Right
            (let moves [ [0 1] [0 -1] [1 0] [-1 0] ])
            
            (for (let m :of moves) (
                (let next-x (+ current.x m[0]))
                (let next-y (+ current.y m[1]))
                (let key '"{(next-x)},{(next-y)}")

                ;; Check bounds and walls
                (if (and (>= next-x 0) (< next-x 5)
                         (>= next-y 0) (< next-y 5)
                         (!= grid[next-y, next-x] 1)
                         (! visited[key]))
                    (do
                        (visited[key] := true)
                        (queue.push (new Point next-x next-y))
                    ))
            ))
        ))
        (return "No path found")
    ))

    (std.console.log (solve-maze))
)
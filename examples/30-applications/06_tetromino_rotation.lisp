(
    ;; ============================================================
    ;; Tetromino rotation — the pure geometry behind Tetris.
    ;; ============================================================
    ;; Extracted from examples/30-games/tetris/tetris.lisp, stripped to
    ;; the parts that are pure and deterministic: no board, no gravity,
    ;; no random 7-bag. What is left is the piece table and the rotation
    ;; transform.
    ;;
    ;; Demonstrates:
    ;; - `defenum` to name the seven tetromino kinds (I O T S Z J L),
    ;;   whose members are the ints 0..6 — usable directly as indices.
    ;; - the tuple type `[Int Int][]`: a cell is an (x, y) pair, a shape
    ;;   is an array of them.
    ;; - one base-shape table + a pure rotation `(x,y) -> (n-1-y, x)`
    ;;   covering all four quarter-turns, so no shape is stored twice.
    ;; ============================================================

    (defenum Kind :i :o :t :s :z :j :l)

    (let NAMES ["I" "O" "T" "S" "Z" "J" "L"])

    ;; A tetromino is 4 cells in an NxN box. I is defined in a 4x4 box,
    ;; O in 2x2, the rest in 3x3. Kind order matches `Kind` / `NAMES`.
    (let SHAPES [
        [[0 1] [1 1] [2 1] [3 1]]
        [[0 0] [1 0] [0 1] [1 1]]
        [[1 0] [0 1] [1 1] [2 1]]
        [[1 0] [2 0] [0 1] [1 1]]
        [[0 0] [1 0] [1 1] [2 1]]
        [[0 0] [0 1] [1 1] [2 1]]
        [[2 0] [0 1] [1 1] [2 1]]])

    (let BOXES [4 2 3 3 3 3 3])

    (fn box-size [kind <- Int] -> Int (return BOXES[kind]))

    (fn base-cells [kind <- Int] -> [Int Int][] (return SHAPES[kind]))

    ;; Rotate `rot` quarter-turns clockwise inside the piece's box. One
    ;; turn maps every cell (x, y) -> (n-1-y, x); doing it `rot % 4`
    ;; times gives the orientation. `cells` is rebound to a fresh array
    ;; each turn, so SHAPES is never mutated.
    (fn piece-cells [kind <- Int rot <- Int] -> [Int Int][]
        (let n (box-size kind))
        (mut cells (base-cells kind))
        (mut turns (% rot 4))
        (while (> turns 0) (
            (let out [])
            (for :each c :from cells :then (
                (let cx c[0])
                (let cy c[1])
                (out.push [(- (- n 1) cy) cx])))
            (cells := out)
            (turns := (- turns 1))))
        (return cells))

    ;; Render a cell list as "(x,y) (x,y) ...".
    (fn show-cells [cells <- [Int Int][]] -> String
        (mut s "")
        (for :each c :from cells :then (
            (s := (+ s '"({(c[0])},{(c[1])}) "))))
        (return (s.trimEnd)))

    ;; Walk the enum from Kind:i (0) to Kind:l (6); print each kind at
    ;; all four rotations.
    (mut kind Kind:i)
    (while (<= kind Kind:l) (
        (console.log '"=== {(NAMES[kind])} (box {(box-size kind)}) ===")
        (mut rot 0)
        (while (< rot 4) (
            (console.log '"  rot {(rot)}: {(show-cells (piece-cells kind rot))}")
            (rot := (+ rot 1))))
        (kind := (+ kind 1))))
)

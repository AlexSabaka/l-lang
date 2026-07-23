(
    ;; ============================================================
    ;; Line clearing — the scoring core of Tetris.
    ;; ============================================================
    ;; Extracted from examples/30-games/tetris/tetris.lisp. Everything
    ;; here is deterministic: a hand-built board goes in, the cleared
    ;; board and the score come out. No piece, no gravity, no RNG.
    ;;
    ;; Demonstrates:
    ;; - std/linq's collection-FIRST pipe on a FRESH source. The game's
    ;;   inline note (tetris.lisp) is explicit: `|> filter |> to-list`
    ;;   is only safe when the source is a fresh array each call, NOT a
    ;;   shared lazy cursor — and `board` is exactly that fresh array.
    ;; - a scoring `cond` chain (`line-score`): 1/2/3/4 lines -> points.
    ;; ============================================================
    (import "std/iter/linq")

    (let EMPTY 0)
    (let WIDTH 6)
    (let HEIGHT 6)

    ;; ---- world (top-level mutable state, like the game) ----
    (mut board [])
    (mut score 0)
    (mut lines 0)
    (mut level 1)

    (fn blank-row [] -> Any[]
        (let row [])
        (mut x 0)
        (while (< x WIDTH) (
            (row.push EMPTY)
            (x := (+ x 1))))
        (return row))

    ;; A row is full when it holds no EMPTY cell.
    (fn row-full [row <- Any] -> Boolean
        (mut full true)
        (for :each v :from row :then (
            (if (== v EMPTY) (full := false))))
        (return full))

    ;; Points for clearing n rows at once — the classic Tetris table.
    (fn line-score [n <- Int] -> Int
        (cond
            ((== n 1) 100)
            ((== n 2) 300)
            ((== n 3) 500)
            (:else    800)))

    ;; Render one row: "." for empty, the cell's digit otherwise.
    (fn show-row [row <- Any] -> String
        (mut s "")
        (for :each v :from row :then (
            (if (== v EMPTY) (s := (+ s ".")) (s := (+ s '"{(v)}")))))
        (return s))

    (fn print-board [] -> Void
        (for :each r :from board :then (
            (console.log '"  {(show-row r)}"))))

    ;; Line clearing reads naturally as a lazy filter, and here the
    ;; source is a fresh array (not a shared cursor), so `to-list` is
    ;; safe. Keep every row that is NOT full, drop the rest, then push
    ;; the survivors down under fresh empty rows. Returns rows cleared.
    (fn clear-lines [] -> Int
        (let kept (board |> (filter (fn [r] (! (row-full r)))) |> to-list))
        (let cleared (- HEIGHT kept.length))
        (if (== cleared 0) (return 0))
        (mut fresh [])
        (mut i 0)
        (while (< i cleared) (
            (fresh.push (blank-row))
            (i := (+ i 1))))
        (for :each r :from kept :then (fresh.push r))
        (board := fresh)
        (lines := (+ lines cleared))
        (score := (+ score (* (line-score cleared) level)))
        ;; `(/ lines 10)` is Int / Int, i.e. already integer division (D49d) -- the `Math.floor`
        ;; that used to wrap it was redundant, and now would return Real into an Int binding.
        (level := (+ 1 (/ lines 10)))
        (return cleared))

    ;; ---- the scoring cond, standalone ----
    (console.log "line-score table:")
    (console.log '"  1 -> {(line-score 1)}")
    (console.log '"  2 -> {(line-score 2)}")
    (console.log '"  3 -> {(line-score 3)}")
    (console.log '"  4 -> {(line-score 4)}")

    ;; ---- hand-built board: rows 3 and 5 are full, the rest are not ----
    (board := [
        [0 0 0 0 0 0]
        [0 0 1 0 0 0]
        [0 2 1 0 0 0]
        [3 3 3 3 3 3]
        [0 4 1 0 5 0]
        [6 6 6 6 6 6]])

    (console.log "before:")
    (print-board)

    (let cleared (clear-lines))

    (console.log '"cleared {(cleared)} rows -> score {(score)}, lines {(lines)}, level {(level)}")
    (console.log "after:")
    (print-board)
)

;; ============================================================
;; FLOOD FILL  (extracted from 30-games/minesweeper)
;; ============================================================
;; The recursive reveal at the heart of Minesweeper, kept deterministic by
;; hand-placing the mines instead of drawing them from `Math.random`.
;;
;; It demonstrates:
;;   - a record type `(deftype Cell {...})`, reference-backed and mutable
;;     through a BOUND intermediate (`(let c ...) (c.mine := true)`)
;;   - optional narrowing: `cell-at` returns `Cell?` (a bounds-checked lookup
;;     is honestly maybe-nothing), and every caller narrows with `(== c nil)`
;;     before touching it
;;   - `match` with `:when` GUARD arms in `cell-glyph`, ordered so hidden and
;;     flagged cells win over the count arms
;;   - `do-reveal`, the recursive flood fill: reveal a cell, and if it borders
;;     no mines (count 0) recurse into all eight neighbours; bounds and
;;     already-revealed cells stop it
;;
;; Two patterns are written AROUND known compiler gaps (see the game's
;; minesweeper-report.md): `cell-at` accumulates into an UNANNOTATED
;; `(mut found nil)` because a `Cell?`-returning fn may not `(return nil)`;
;; and `cell-glyph`'s hidden/flagged split is two guard arms rather than one
;; arm with a bare `(if ...)` body, which would silently fail to fire.
;; ============================================================
(
    ;; ---------------- board ----------------
    (let WIDTH 5)
    (let HEIGHT 5)

    ;; A record. Records are reference-backed; mutate through a bound name.
    (deftype Cell {:mine <- Boolean :revealed <- Boolean :flagged <- Boolean :count <- Int})

    (mut cells <- Cell[] [])

    (fn idx [x <- Int y <- Int] -> Int (return (+ (* y WIDTH) x)))

    (fn in-bounds [x <- Int y <- Int] -> Boolean
        (return (&& (&& (>= x 0) (< x WIDTH)) (&& (>= y 0) (< y HEIGHT)))))

    ;; The total accessor: a bounds-checked lookup is honestly `Cell?`.
    ;; GAP: a `Cell?`-returning fn may not `(return nil)`, and `(mut r <- Cell? nil)`
    ;; is rejected too -- only an UNANNOTATED nil accumulator is accepted.
    (fn cell-at [x <- Int y <- Int] -> Cell?
        (mut found nil)
        (if (in-bounds x y) (found := (get cells (idx x y))))
        (return found))

    (fn blank-board [] -> Void
        (let out [])
        (mut i 0)
        (let n (* WIDTH HEIGHT))
        (while (< i n) (
            (out.push {:mine false :revealed false :flagged false :count 0})
            (i := (+ i 1))))
        (cells := out))

    ;; ---------------- mines (hand-placed, no RNG) ----------------
    (fn place-mine [x <- Int y <- Int] -> Void
        (let c cells[(idx x y)])     ;; bound intermediate -> mutation sticks
        (c.mine := true))

    (fn neighbour-offsets [] -> Any
        (return [[-1 -1] [0 -1] [1 -1] [-1 0] [1 0] [-1 1] [0 1] [1 1]]))

    (fn count-neighbours [x <- Int y <- Int] -> Int
        (mut total 0)
        (for :each d :from (neighbour-offsets) :then (
            (let nx (+ x d[0]))
            (let ny (+ y d[1]))
            (let c (cell-at nx ny))
            ;; optional narrowing: only a real neighbour counts
            (if (!= c nil) (if c.mine (total := (+ total 1))))))
        (return total))

    (fn compute-counts [] -> Void
        (mut i 0)
        (let n (* WIDTH HEIGHT))
        (while (< i n) (
            (let c cells[i])
            ;; No `Math.floor` around `(/ i WIDTH)`: both operands are Int, so D49d already makes
            ;; this integer division. The wrapper was redundant, and under D51 amendment (b) it
            ;; would now return Real into an Int-typed parameter.
            (if (! c.mine) (c.count := (count-neighbours (% i WIDTH) (/ i WIDTH))))
            (i := (+ i 1)))))

    ;; ---------------- the recursive flood ----------------
    ;; Reveal a cell; if it borders no mines, open all eight neighbours.
    ;; `cell-at` is `Cell?`, so narrow before touching it.
    (fn do-reveal [x <- Int y <- Int] -> Void
        (let c (cell-at x y))
        (if (== c nil) (return))
        (if c.flagged (return))
        (if c.revealed (return))
        (c.revealed := true)
        (if c.mine (return))
        (if (== c.count 0) (
            (for :each d :from (neighbour-offsets) :then (
                (do-reveal (+ x d[0]) (+ y d[1])))))))

    (fn revealed-count [] -> Int
        (mut total 0)
        (for :each c :from cells :then (
            (if c.revealed (total := (+ total 1)))))
        (return total))

    ;; ---------------- rendering ----------------
    ;; The glyph for a cell. A match arm whose body is a bare `(if ...)`
    ;; silently fails to fire, so the flag/hidden split is two guard arms.
    (fn cell-glyph [c <- Cell reveal-mines <- Boolean] -> String
        (if (&& reveal-mines c.mine) (return "*"))
        (return (match c.count {
            n :when (&& (! c.revealed) c.flagged) => "F"
            n :when (! c.revealed)                => "·"
            0                                     => " "
            n :when (< n 9)                       => (+ "" n)
            _                                     => "?"
        })))

    (fn print-grid [reveal-mines <- Boolean] -> Void
        (mut y 0)
        (while (< y HEIGHT) (
            (mut line "")
            (mut x 0)
            (while (< x WIDTH) (
                (let c cells[(idx x y)])
                (line := (+ line (cell-glyph c reveal-mines)))
                (x := (+ x 1))))
            (console.log line)
            (y := (+ y 1)))))

    ;; ---------------- driver ----------------
    (blank-board)
    (place-mine 3 1)
    (place-mine 1 3)
    (place-mine 4 3)
    (place-mine 2 4)
    (compute-counts)

    (console.log "mines at (3,1) (1,3) (4,3) (2,4)")
    (console.log "revealed by a flood fill from corner (0,0):")
    (do-reveal 0 0)
    (print-grid false)
    (console.log '"cells revealed: {(revealed-count)}")

    (console.log "--- same board, all mines shown ---")
    (print-grid true)
)

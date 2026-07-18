;; ============================================================
;; A DETERMINISTIC SNAKE TICK  (extracted from 30-games/snake)
;; ============================================================
;; The pure part of Snake -- one step of the world -- with the food RNG
;; replaced by a fixed queue so the whole run is reproducible.
;;
;; It demonstrates:
;;   - `(defenum Direction ...)` and enum equality / `match` on it
;;   - a mutable MAP as the whole game state (`world.snake`, `world.dir`, ...)
;;   - STRUCTURAL tuple equality: `(== [x y] [x y])` compares element-wise, so
;;     "did the head land on the food?" and "did it hit its own body?" are
;;     plain `==`, no hand-written comparator
;;   - `try-turn`: the pure 180°-reversal rule -- steering into the direct
;;     opposite of the current heading is rejected and the heading is kept,
;;     which is what stops the snake from instantly eating its own neck
;;   - a pure `tick`: advance the head, test wall / self collision, grow on
;;     food or drop the tail otherwise
;;
;; The interactive loop (setInterval + raw-mode keypresses) is gone; a scripted
;; list of steering inputs drives the world and every tick prints its state.
;; ============================================================
(
    (import "std/string")

    (defenum Direction :up :down :left :right)

    (let WIDTH 8)
    (let HEIGHT 5)

    ;; A fixed food queue stands in for spawn-food's `Math.random` loop.
    (let FOODS [[5 2] [5 0] [2 4]])
    (mut food-i 0)

    ;; ---------------- world: one mutable map ----------------
    (mut world
        { :snake   [[3 2] [2 2] [1 2]]
          :dir     Direction:right
          :nextdir Direction:right
          :food    [0 0]
          :score   0
          :alive   true })

    (fn spawn-food [] (
        (world.food := FOODS[food-i])
        (if (< (+ food-i 1) FOODS.length) (food-i := (+ food-i 1)))))

    ;; ---------------- structural tuple equality ----------------
    ;; `(== a b)` on two-element arrays is element-wise, so membership is a
    ;; plain scan with `==` -- no bespoke cell comparator needed.
    (fn cell-in [c <- Any cells <- Any[]] -> Boolean
        (mut found false)
        (for :each k :from cells :then (
            (if (== c k) (found := true))))
        (return found))

    ;; snake body without the head (for self-collision)
    (fn body-without-head [] -> Any[] (
        (let s world.snake)
        (if (<= s.length 1) (return []))
        (let out [])
        (mut i 1)
        (while (< i s.length) (
            (out.push s[i])
            (i := (+ i 1))))
        (return out)))

    (fn prepend [item <- Any items <- Any[]] -> Any[] (
        (let out [item])
        (mut i 0)
        (while (< i items.length) (
            (out.push items[i])
            (i := (+ i 1))))
        (return out)))

    (fn drop-last [v <- Any[]] -> Any[] (
        (let n v.length)
        (if (<= n 1) (return []))
        (let out [])
        (mut i 0)
        (while (< i (- n 1)) (
            (out.push v[i])
            (i := (+ i 1))))
        (return out)))

    ;; ---------------- direction handling ----------------
    ;; Reject a 180° reversal: keep the current heading instead of steering
    ;; straight back into the neck.
    (fn try-turn [d <- Any] -> Any (
        (let cur world.dir)
        (if (|| (&& (== cur Direction:up)    (== d Direction:down))
                (&& (== cur Direction:down)  (== d Direction:up))
                (&& (== cur Direction:left)  (== d Direction:right))
                (&& (== cur Direction:right) (== d Direction:left)))
            (return cur))
        (return d)))

    (fn apply-direction [] (
        (let d (try-turn world.nextdir))
        (world.dir := d)
        (world.nextdir := d)))

    (fn step-vector [v <- Any d <- Any] -> Any
        (cond
            ((== d Direction:up)    (return [v[0] (- v[1] 1)]))
            ((== d Direction:down)  (return [v[0] (+ v[1] 1)]))
            ((== d Direction:left)  (return [(- v[0] 1) v[1]]))
            ((== d Direction:right) (return [(+ v[0] 1) v[1]]))
            (true                   (return v))))

    ;; ---------------- one pure tick ----------------
    (fn tick [] (
        (if (! world.alive) (return))
        (apply-direction)
        (let head world.snake[0])
        (let new-head (step-vector head world.dir))
        (let hx new-head[0])
        (let hy new-head[1])
        ;; wall collision
        (if (|| (< hx 0) (>= hx WIDTH) (< hy 0) (>= hy HEIGHT)) (
            (world.alive := false)
            (return)))
        ;; self collision -- structural membership in the body
        (if (cell-in new-head (body-without-head)) (
            (world.alive := false)
            (return)))
        ;; advance: grow on food, else drop the tail
        (let grew (== new-head world.food))
        (world.snake := (prepend new-head world.snake))
        (if (! grew)
            (world.snake := (drop-last world.snake)))
        (if grew (
            (world.score := (+ world.score 1))
            (spawn-food)))))

    ;; ---------------- reporting ----------------
    (fn dir-name [d <- Any] -> String
        (match d {
            Direction:up    => "up"
            Direction:down  => "down"
            Direction:left  => "left"
            Direction:right => "right"
            _               => "?"
        }))

    (fn body-str [] -> String
        (mut s "")
        (let sn world.snake)
        (mut i 0)
        (while (< i sn.length) (
            (let p sn[i])
            (s := (+ s "[" (+ "" p[0]) "," (+ "" p[1]) "]"))
            (i := (+ i 1))))
        (return s))

    (fn print-status [label <- String] -> Void
        (let h world.snake[0])
        (let hx h[0])
        (let hy h[1])
        (let len world.snake.length)
        (console.log '"{(label)}  dir={(dir-name world.dir)}  head=[{(hx)},{(hy)}]  len={(len)}  score={(world.score)}  alive={(world.alive)}"))

    (fn tick-with [label <- String d <- Any] -> Void
        (world.nextdir := d)
        (tick)
        (print-status label))

    ;; ---------------- rendering (no clear-screen) ----------------
    (fn blank-row [] -> String
        (mut s "")
        (mut i 0)
        (while (< i WIDTH) ((s := (+ s ".")) (i := (+ i 1))))
        (return s))

    (fn replace-char [row <- String i <- Int ch <- String] -> String
        (let prefix (substr row 0 i))
        (let suffix (substr row (+ i 1) (strlen row)))
        (return (+ prefix ch suffix)))

    (fn render [] -> Void
        (let frame [])
        (mut y 0)
        (while (< y HEIGHT) ((frame.push (blank-row)) (y := (+ y 1))))
        (let f world.food)
        (let fx f[0])
        (let fy f[1])
        (frame[fy] := (replace-char frame[fy] fx "*"))
        (let sn world.snake)
        (let head sn[0])
        (let hx head[0])
        (let hy head[1])
        (frame[hy] := (replace-char frame[hy] hx "O"))
        (mut i 1)
        (while (< i sn.length) (
            (let p sn[i])
            (let px p[0])
            (let py p[1])
            (frame[py] := (replace-char frame[py] px "o"))
            (i := (+ i 1))))
        (mut border "")
        (mut b 0)
        (while (< b WIDTH) ((border := (+ border "-")) (b := (+ b 1))))
        (console.log (+ "+" border "+"))
        (mut row 0)
        (while (< row HEIGHT) (
            (console.log (+ "|" frame[row] "|"))
            (row := (+ row 1)))
        )
        (console.log (+ "+" border "+")))

    ;; ---------------- driver ----------------
    (spawn-food)                        ;; food -> [5 2]
    (print-status "start ")

    (console.log "-- try-turn is pure; current heading is right --")
    (console.log '"  steer left -> {(dir-name (try-turn Direction:left))}   (180 reversal rejected)")
    (console.log '"  steer up   -> {(dir-name (try-turn Direction:up))}      (accepted)")

    (console.log "-- ticks --")
    (tick-with "t1 in=right" Direction:right)
    (tick-with "t2 in=right" Direction:right)   ;; head reaches food [5 2] -> grow
    (tick-with "t3 in=up   " Direction:up)
    (tick-with "t4 in=down " Direction:down)    ;; reversal of up -> kept up; eats food [5 0]
    (tick-with "t5 in=left " Direction:left)

    (console.log "-- final frame --")
    (render)
    (console.log '"final snake: {(body-str)}")
)

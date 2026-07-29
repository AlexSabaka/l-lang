;; ============================================================
;; AN UNDOABLE MOVE  (extracted from 30-games/sokoban)
;; ============================================================
;; The single most distinct construct in the games corpus: a `defmodifier`
;; whose body is a REAL runtime decorator, plus the struct value-semantics
;; rule that makes its undo stack correct.
;;
;; Two features, welded together:
;;
;;   1. `(defmodifier undoable ...)` evaluates to a decorator -- a function
;;      taking the original function and returning its replacement. The
;;      replacement snapshots the world, delegates to the real move, and
;;      DROPS its own snapshot if the move turned out to be illegal. So the
;;      undo stack only ever holds states the player actually left. Applied
;;      with `(fn :undoable move ...)`; the move body knows nothing about it.
;;
;;   2. A struct is a VALUE, so binding one is a copy -- EXCEPT a copy does
;;      NOT deep-copy a reference-typed field. `boxes` is an array, so a naive
;;      `(let s world)` snapshot would alias it and every undo would leave the
;;      boxes where they ended up. `snapshot` rebuilds `boxes` element-by-
;;      element instead. (This is the rule goldened by
;;      examples/04-data-types/10_value_semantics.lisp.)
;;
;; Sokoban uses no RNG, so a scripted move sequence is fully deterministic.
;; The proof that the array-rebuild matters is the LAST step: after a push
;; puts the box on the goal, `undo` restores the box to its ORIGINAL cell --
;; which an aliased snapshot could never do.
;; ============================================================
(
    (import "std/core/string")

    ;; ---- the world: a struct, so binding it is a COPY ----
    (defstruct World
        (mut :ctor px     <- Int 0)
        (mut :ctor py     <- Int 0)
        (mut :ctor moves  <- Int 0)
        (mut :ctor pushes <- Int 0)
        (mut :ctor boxes  <- Any []))

    (mut world (World 0 0 0 0 []))
    (mut walls [])
    (mut goals [])
    (mut rows 0)
    (mut cols 0)
    (mut undo-stack [])

    (fn wall-at [x <- Int y <- Int] -> Boolean
        (if (|| (< y 0) (>= y rows)) (return true))
        (let row walls[y])
        (if (|| (< x 0) (>= x row.length)) (return true))
        (return row[x]))

    (fn goal-at [x <- Int y <- Int] -> Boolean
        (if (|| (< y 0) (>= y rows)) (return false))
        (let row goals[y])
        (if (|| (< x 0) (>= x row.length)) (return false))
        (return row[x]))

    ;; Index of the box standing on (x y), or -1.
    (fn box-index [x <- Int y <- Int] -> Int
        (mut found -1)
        (mut i 0)
        (let bs world.boxes)
        (while (< i bs.length) (
            (let b bs[i])
            ;; NOTE: the index reads are bound to locals first. Feeding raw
            ;; `(== b[0] x)` / `(== b[1] y)` straight into `&&` trips a codegen
            ;; bug where the short-circuit result temp is emitted `const` and
            ;; then reassigned ("Assignment to constant variable"); binding the
            ;; index reads first sidesteps it.
            (let bx b[0])
            (let by b[1])
            (if (&& (== bx x) (== by y)) (found := i))
            (i := (+ i 1))))
        (return found))

    ;; ---- parse the inline level into walls / goals / boxes / player ----
    ;;   #  wall     .  goal     $  box     *  box on goal
    ;;   @  player   +  player on goal    (space) floor
    (fn parse-level [src <- String] -> Void
        (let lines (split src "\n"))
        (walls := [])
        (goals := [])
        (mut bs [])
        (mut px 0)
        (mut py 0)
        (rows := lines.length)
        (cols := 0)
        (mut y 0)
        (while (< y lines.length) (
            (let line lines[y])
            (let wrow [])
            (let grow [])
            (if (> (strlen line) cols) (cols := (strlen line)))
            (mut x 0)
            (while (< x (strlen line)) (
                (let ch (substr line x (+ x 1)))
                (wrow.push (== ch "#"))
                (grow.push (|| (== ch ".") (|| (== ch "*") (== ch "+"))))
                (if (|| (== ch "$") (== ch "*")) (bs.push [x y]))
                (if (|| (== ch "@") (== ch "+")) ((px := x) (py := y)))
                (x := (+ x 1))))
            (walls.push wrow)
            (goals.push grow)
            (y := (+ y 1))))
        (world := (World px py 0 0 bs))
        (undo-stack := []))

    ;; ---- snapshot: rebuild the boxes array element-by-element ----
    ;; A struct copy shares reference-typed fields, so `(let s world)` would
    ;; alias `boxes`. Rebuilding it by hand is what makes a snapshot truly
    ;; independent of the live world.
    (fn snapshot [] -> World
        (let bs [])
        (for :each b :from world.boxes :then (
            (bs.push [b[0] b[1]])))
        (return (World world.px world.py world.moves world.pushes bs)))

    ;; ---- the modifier: a real stateful decorator ----
    ;; It snapshots before delegating, and drops its own snapshot when the
    ;; wrapped move reports it was illegal (returned false).
    (defmodifier undoable []
        (fn [original ...args]
            (undo-stack.push (snapshot))
            (let ok (original ...args))
            (if (! ok) (undo-stack.pop) nil)
            (return ok)))

    (fn undo [] -> Boolean
        (if (== undo-stack.length 0) (return false))
        (let prev (undo-stack.pop))
        (if (== prev nil) (return false))
        (world := prev)
        (return true))

    ;; ---- the wrapped move ----
    ;; `:undoable` wraps this. The body just reports whether the move happened.
    (fn :undoable move [dx <- Int dy <- Int] -> Boolean
        (let nx (+ world.px dx))
        (let ny (+ world.py dy))
        (if (wall-at nx ny) (return false))
        (let bi (box-index nx ny))
        (if (== bi -1) (
            (world.px := nx)
            (world.py := ny)
            (world.moves := (+ world.moves 1))
            (return true)))
        ;; A box is there: it can move only into free floor.
        (let bx (+ nx dx))
        (let by (+ ny dy))
        (if (wall-at bx by) (return false))
        (if (!= (box-index bx by) -1) (return false))
        (world.boxes[bi] := [bx by])
        (world.px := nx)
        (world.py := ny)
        (world.moves := (+ world.moves 1))
        (world.pushes := (+ world.pushes 1))
        (return true))

    (fn solved [] -> Boolean
        (mut ok true)
        (mut y 0)
        (while (< y rows) (
            (mut x 0)
            (while (< x cols) (
                (if (&& (goal-at x y) (== (box-index x y) -1)) (ok := false))
                (x := (+ x 1))))
            (y := (+ y 1))))
        (return ok))

    ;; ---- render (plain ASCII, no clear-screen) ----
    (fn glyph-at [x <- Int y <- Int] -> String
        (let is-goal (goal-at x y))
        (let is-box  (!= (box-index x y) -1))
        (let is-you  (&& (== world.px x) (== world.py y)))
        (cond
            ((wall-at x y)       (return "#"))
            ((&& is-box is-goal) (return "*"))
            (is-box              (return "$"))
            ((&& is-you is-goal) (return "+"))
            (is-you              (return "@"))
            (is-goal             (return "."))
            (true                (return " "))))

    (fn print-board [] -> Void
        (mut y 0)
        (while (< y rows) (
            (mut line "")
            (mut x 0)
            (while (< x cols) (
                (line := (+ line (glyph-at x y)))
                (x := (+ x 1))))
            (console.log line)
            (y := (+ y 1)))))

    (fn print-state [label <- String] -> Void
        (console.log label)
        (print-board)
        (console.log f"moves {(world.moves)}  pushes {(world.pushes)}  undo-depth {(undo-stack.length)}  solved {(solved)}")
        (console.log ""))

    ;; A move plus a one-line verdict of whether it was accepted.
    (fn do-move [name <- String dx <- Int dy <- Int] -> Void
        (let ok (move dx dy))
        (mut verdict "rejected")
        (if ok (verdict := "accepted"))
        (print-state (+ name " -> " verdict)))

    ;; ---- driver ----
    ;;   #######
    ;;   #     #
    ;;   #.$@  #   player @ at (3,2), box $ at (2,2), goal . at (1,2)
    ;;   #     #
    ;;   #######
    (let LEVEL "#######\n#     #\n#.$@  #\n#     #\n#######")
    (parse-level LEVEL)
    (print-state "initial")

    (do-move "down"  0  1)   ;; legal step onto floor
    (do-move "down"  0  1)   ;; into the wall -> illegal, snapshot rolled back
    (do-move "up"    0 -1)   ;; back up
    (do-move "left" -1  0)   ;; pushes the box left onto its goal -> solved

    (undo)                   ;; and back: the box returns to its original cell
    (print-state "after undo")
)

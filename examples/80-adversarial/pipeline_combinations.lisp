;; PIPELINES crossed with the other forms, and `<|`'s ARGUMENT ORDER pinned.
;;
;; `01-functions/04_pipelines.lisp` shows both operators working in isolation. Two things it does not
;; do, and this file does:
;;
;; 1. `<|` HAS FOUR USES IN THE ENTIRE TREE. Its whole meaning is that the piped value becomes the
;;    RIGHT argument where `|>` makes it the left, so `(5 |> (sub 7))` is -2 and `(5 <| (sub 7))` is
;;    2. Those two rows are the same call with the operands swapped; if a refactor ever made the two
;;    operators agree, one of them would silently become a synonym for the other and four call sites
;;    is not enough to notice.
;;
;; 2. A pipeline is not put inside a GENERATOR FRAME or a CATCH ARM anywhere. Those are the two
;;    positions this project broke repeatedly -- a catch arm was reached by NO rewriting pass at all
;;    until the `mapChildArray` record fix, and a generator frame moves every binding into a boxed
;;    slot. A pipeline happens to survive both, and measurement says why: it is resolved before the
;;    rewriting passes run, so the catch-arm rows below were already correct with that fix reverted.
;;    That is worth pinning precisely BECAUSE it is a different mechanism from the ones that broke.
;;
;; NO DEFECT WAS FOUND WRITING THIS. Thirteen rows, both backends, all correct.
(
    (import "std/protocols")

    (fn sub [x <- Int  y <- Int] -> Int (return (- x y)))
    (fn add [x <- Int  y <- Int] -> Int (return (+ x y)))
    (fn square [x <- Int] -> Int (return (* x x)))
    (fn triple [x <- Int] -> Int (return (* x 3)))

    ;; -- THE ORDER PAIR. Same function, same operands, opposite operators.
    (console.log "forward:" (5 |> (sub 7)))
    (console.log "backward:" (5 <| (sub 7)))
    (console.log "mixed:" (5 <| (sub 7) |> (add 1)))

    ;; -- the callee shapes: a bare name, and a lambda literal
    (console.log "bare name:" (5 |> square))
    (console.log "lambda:" (5 |> (fn [x <- Int] -> Int (return (* x 3)))))

    ;; -- a four-stage chain, so an off-by-one in the fold shows as a wrong number
    (console.log "long chain:" (2 |> (add 3) |> square |> (sub 5) |> triple))

    ;; -- VALUE POSITIONS: as a call argument, and in a function's TAIL. The tail row is the one D114
    ;;    had to fix for `try` -- a form that yields must yield here too, and a pipeline already does.
    (console.log "as argument:" (triple (5 |> (add 1))))
    (fn tailed [] -> Int (5 |> square))
    (console.log "in tail:" (tailed))

    ;; -- INSIDE A GENERATOR FRAME, both operators, across two suspensions.
    (fn :gen g [] -> Iterator<Int> ((yield (5 |> square)) (yield (2 <| (sub 9)))))
    (mut gen-total 0)
    (for :each x :from (g) :then (gen-total := (+ gen-total x)))
    (console.log "in a generator:" gen-total)

    ;; -- INSIDE A PROTECTED REGION: the try body, and the CATCH ARM.
    (mut t 0)
    (try ((t := (5 |> square)) (throw (new ValueError "boom")))
      catch e ((t := (+ t (2 |> triple)))))
    (console.log "try body and catch arm:" t)

    (mut c 0)
    (try ((throw (new ValueError "boom"))) catch e ((c := (3 |> square))))
    (console.log "catch arm alone:" c)

    ;; -- INSIDE A LOOP BODY, and INTO A DECORATED function, so the D75 unfold and the pipeline fold
    ;;    compose: dsquare(3) is 9, doubled by the modifier.
    (mut loop-total 0)
    (for :each x :from [1 2 3] :then (loop-total := (+ loop-total (x |> triple))))
    (console.log "in a loop:" loop-total)

    (defmodifier dbl [] (fn [original ...args] (* (original ...args) 2)))
    (fn :dbl dsquare [x <- Int] -> Int (* x x))
    (console.log "into a decorated fn:" (3 |> dsquare))
)

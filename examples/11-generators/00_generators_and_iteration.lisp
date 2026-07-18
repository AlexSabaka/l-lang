;; Generators - (fn :gen ...) + yield, and the iteration protocol (D30/D31)
;;
;; This example demonstrates:
;; - `:gen` makes a function a GENERATOR: (yield v) hands one value to the consumer and
;;   pauses right there until the next value is asked for
;; - `for :each` is DEFINED by std/iter's Iterable<T>/Iterator<T>, so it drives a generator
;;   directly - no bridge, no materialised list
;; - an INFINITE generator consumed FINITELY: (take n) pulls only what it needs
;; - a hand-written iterator - a struct :implements Iterable<Int> - plugs into the same
;;   `for :each` and the same lazy operators as a generator
;; - the raw cursor: (iter src) / (next it), where nil MEANS done

(
    (import "std/iter")
    (import "std/linq")

    ;; 1. A finite generator. Each (yield i) produces one value and suspends the function;
    ;;    the `while` resumes only when the consumer pulls again.
    (fn :gen count-up [n <- Int] -> Iterator<Int> (
        (mut i 1)
        (while (<= i n) (
            (yield i)
            (i := (+ i 1))
        ))
    ))

    (console.log "--- count-up 5 ---")
    (for :each v :from (count-up 5) :then (console.log v))

    ;; 2. An INFINITE generator: `fibs` has no exit - (while true) - and never returns. That is
    ;;    perfectly safe, because a generator computes nothing until it is pulled. `take 8`
    ;;    asks for eight values and stops. An EAGER take would hang here forever.
    (fn :gen fibs [] -> Iterator<Int> (
        (mut a 0)
        (mut b 1)
        (while true (
            (yield a)
            (let nxt (+ a b))
            (a := b)
            (b := nxt)
        ))
    ))

    (console.log "--- first 8 fibs (take over an infinite source) ---")
    (let f8 ((fibs) |> (take 8) |> to-list))
    (console.log (f8.join " "))

    ;; 3. A whole lazy pipeline over that same infinite source. `filter` and `take-while` are
    ;;    generators too, so the chain stays a pull all the way down: it walks the fibs only
    ;;    until take-while sees its first value past the limit, then stops.
    (fn is-even [n] (== (% n 2) 0))

    (console.log "--- even fibs below 1000 ---")
    (let small-evens ((fibs) |> (filter is-even) |> (take-while (fn [n] (< n 1000))) |> to-list))
    (console.log (small-evens.join " "))

    ;; 4. The protocol BY HAND. A generator is not the only Iterable: any struct that reports
    ;;    itself as one works too - iterator() hands back a cursor, next() returns T? where nil
    ;;    means done. (An Iterator IS an Iterable, which is why this one returns `this`.)
    (defstruct Countdown :implements Iterable<Int>
        (mut :ctor n <- Int)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (<= this.n 0)
                (return nil)
                (
                    (let cur this.n)
                    (this.n := (- this.n 1))
                    (return cur)
                ))
        ))
    )

    (console.log "--- Countdown 3 (hand-written iterator) ---")
    (for :each x :from (new Countdown 3) :then (console.log x))

    ;; 5. ONE protocol, so the two kinds of source compose freely: `zip` pulls a generator and
    ;;    a hand-written iterator in lockstep, stopping the moment EITHER runs out.
    (console.log "--- zip: generator + struct ---")
    (for :each [up down] :from ((count-up 5) |> (zip (new Countdown 3))) :then (
        (console.log '"{(up)} <-> {(down)}")
    ))

    ;; 6. The raw cursor underneath all of it. (iter src) works over any Iterable - array,
    ;;    generator or struct - and (next it) returns nil once the sequence is exhausted.
    (console.log "--- raw cursor over count-up 3 ---")
    (let it (iter (count-up 3)))
    (mut v (next it))
    (while (!= v nil) (
        (console.log '"pulled {(v)}")
        (v := (next it))
    ))
    (console.log "cursor exhausted")
)

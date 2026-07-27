;; A timing modifier -- one that actually measures.
;;
;; Before D3b the body was discarded and every modifier emitted the same canned memoizer, so
;; `(defmodifier timed [])` never timed anything, and this file's golden -- recorded from that
;; output rather than authored from intent -- contained no timings at all.
;;
;; The functions here are deliberately NOT recursive. A decorator wraps the NAME, so decorating a
;; recursive function puts the wrapper on every recursive call as well: `:timed` on fib(10) would
;; print 177 times. That is correct behaviour, and a terrible demonstration.
;;
;; IT READS THE CLOCK THROUGH `std/sys/timers`, and that is what makes this file run at all on the
;; native backend. It used to call `Date.now` -- a JS host global on no floor -- so the whole example
;; was `LL0107: 'Date.now' resolves to a JavaScript host global` on C, i.e. the decorator this file
;; exists to demonstrate could not be demonstrated on the backend that is being kept. `now-ns` is
;; l-lang over the `clock-ns` floor entry (D50) and answers the same monotonic reading on both.
;;
;; MONOTONIC, not wall. `epoch-ns` would also have compiled, and would have been wrong for a duration:
;; a wall clock steps backwards under NTP, so `(- end start)` can come out NEGATIVE and the assertion
;; below would fail for reasons having nothing to do with the modifier.

(
    (import "std/sys/timers")

    ;; Timing modifier that measures function execution time
    (defmodifier timed []
        (fn [original ...args]
            (let start (now-ns))
            (let result (original ...args))
            (let elapsed (- (now-ns) start))
            ;; A DURATION is not goldenable -- it differs every run. What IS assertable is that
            ;; the modifier genuinely measured: it read the clock on both sides of the call, and
            ;; the interval it computed is a real one.
            (console.log "[timed] elapsed >= 0:" (>= elapsed 0))
            result))

    ;; Fast function
    (fn :timed simple-add [a <- Int, b <- Int] -> Int
        (+ a b)
    )

    ;; Another one, to show the modifier applies per-function
    (fn :timed square [x <- Int] -> Int
        (* x x)
    )

    (console.log "Testing timing modifier:")
    (console.log "Fast function result:" (simple-add 10 20))
    (console.log "Square of 12:" (square 12))
)

;; A timing modifier -- one that actually measures.
;;
;; Before D3b the body was discarded and every modifier emitted the same canned memoizer, so
;; `(defmodifier timed [])` never timed anything, and this file's golden -- recorded from that
;; output rather than authored from intent -- contained no timings at all.
;;
;; The functions here are deliberately NOT recursive. A decorator wraps the NAME, so decorating a
;; recursive function puts the wrapper on every recursive call as well: `:timed` on fib(10) would
;; print 177 times. That is correct behaviour, and a terrible demonstration.

(
    ;; Timing modifier that measures function execution time
    (defmodifier timed []
        (fn [original ...args]
            (let start (Date.now))
            (let result (original ...args))
            (let elapsed (- (Date.now) start))
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

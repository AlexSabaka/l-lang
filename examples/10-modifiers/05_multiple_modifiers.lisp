;; Stacking modifiers -- and why the ORDER matters.
;;
;; Before D3b every modifier emitted the same canned memoizer, so `:logged :memoized` was two
;; identical memoizers nested, and this file's golden -- recorded from that output rather than
;; authored from intent -- showed neither a log line nor a cache hit. It even contained a literal
;; `\n` (a backslash and an n, not a newline), which is what recording rather than authoring gets you.
;;
;; Modifiers are applied left to right, each wrapping the result of the last -- so the RIGHTMOST
;; modifier ends up OUTERMOST:
;;
;;     (fn :logged :memoized square ...)   ==>   memoized(logged(square))
;;
;; The cache therefore sits in front of the logger, and a cache HIT never reaches it. The second
;; call below prints no log line at all. Swap the two modifiers and it would.

(
    (defmodifier logged []
        (fn [original]
            (fn [...args]
                (console.log "[log] call:" args)
                (original ...args))))

    ;; `(get cache n)` asks whether the key is THERE; `cache[n]` asserts that it is. The indexer is
    ;; partial after D9 and would throw on the first, uncached call. The write below stays a plain
    ;; `cache[n] :=` -- a write CREATES -- and so does the final read, which runs only once the key
    ;; is known to exist.
    (defmodifier memoized []
        (fn [original]
            (let cache {})
            (fn [n]
                (if (== (get cache n) nil)
                    (cache[n] := (original n)))
                cache[n])))

    ;; A deliberately visible computation, so a cache hit is observable: "computing" appears once
    ;; per distinct argument, never twice.
    (fn :logged :memoized square [n <- Int] -> Int
        (console.log "  computing" n)
        (* n n)
    )

    (console.log "Testing multiple modifiers:")

    (console.log "First call square(8) -- misses the cache, so it logs and computes:")
    (console.log (square 8))

    ;; The cache is the OUTER wrapper, so a hit short-circuits before the logger runs.
    (console.log "Second call square(8) -- cache HIT, so no log and no compute:")
    (console.log (square 8))

    (console.log "A different argument -- misses again, so it logs and computes:")
    (console.log (square 3))
)

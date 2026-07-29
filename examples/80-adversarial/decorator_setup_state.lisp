;; ADVERSARIAL: D75's SETUP SLOT RUNS ONCE, AND ONCE *PER DECORATED FUNCTION*.
;;
;; `(defmodifier memoized [] (let cache {}) (fn [original n] …))` -- the `(let cache {})` is the setup
;; slot, and it is the reason the slot exists at all: a decorator with no decoration-time state is
;; just a function. The C backend refused it by name (`ELL0106 decorator-setup:memoized`) rather than
;; dropping it, which was the right call while it was unbuilt, because dropping it silently would
;; give every call a fresh cache -- a memoizer that memoizes nothing while appearing to work.
;;
;; A layer is unfolded into an ORDINARY TOP-LEVEL C FUNCTION (D75), and a C function cannot see
;; `main`'s locals, so the binding is hoisted to a file-scope global initialised before the module
;; body runs. That is the same obstruction `computeGlobals` solves for module-level bindings.
;;
;; THE PART THAT NEEDED A GUARD IS THE KEY. The global is named after the LAYER, not the modifier, so
;; `:memoized` on two functions gets two caches. Keyed by modifier they would share one, and since the
;; key here is the argument, `(cube 3)` would answer `9` -- the square's cached result, silently, and
;; only for arguments both functions happen to have seen.
(
    (defmodifier memoized []
        ;; `(get cache n)` asks whether the key is THERE; `cache[n]` asserts that it is. The indexer is
        ;; partial after D9 and would throw on the first, uncached call.
        (let cache {})
        (fn [original n]
            (if (== (get cache n) nil)
                (cache[n] := (original n)))
            cache[n]))

    ;; Both decorated with the SAME modifier, and both called with the SAME argument -- which is the
    ;; only way a shared cache is observable at all.
    (fn :memoized square [n <- Int] -> Int (
        (console.log "  computing square" n)
        (* n n)))
    (fn :memoized cube [n <- Int] -> Int (
        (console.log "  computing cube" n)
        (* n (* n n))))

    (console.log "square 3:" (square 3))
    (console.log "cube 3  :" (cube 3))

    ;; -- and the state PERSISTS, which is the other half ---------------------------------------------
    ;;
    ;; No "computing" line below. A setup slot re-run per call would print two more and still answer
    ;; correctly, so the values alone do not test this -- the absence of the trace is the assertion.

    (console.log "square 3:" (square 3))
    (console.log "cube 3  :" (cube 3))

    ;; A different argument misses both caches, proving the caches are live rather than merely absent.
    (console.log "square 4:" (square 4))
    (console.log "done")
)

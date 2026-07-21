;; D47 at depth: a signal raised 20 call frames down, recovered by a restart established at the top --
;; ll_unwind collapses the whole C stack segment in one longjmp while still running the cleanups it
;; crosses. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: `deep 20` recurses to n=0 and signals; the handler invoke-restarts :bail 99;
;; the unwind crosses the re-arm pad and the CLEANUP frame wrapping the call (prints `depth 0`, exactly
;; once -- the recursive frames establish no cleanups) and lands at the arm binding v=99.
;; Expected: depth 0 then 99.
(
    (defclass Alert :extends Error (let :ctor message))
    (fn deep [n] -> Int (
        (if (== n 0)
            ((signal (Alert "bottom")) (return -1))
            (return (deep (- n 1))))
    ))
    (fn f [] -> Int (
        (restart-case
            (try (deep 20) finally (console.log "depth 0"))
            (:bail [v] v))
    ))
    (handle
        ((console.log (f)))
        (:on Alert [] (invoke-restart :bail 99)))
)

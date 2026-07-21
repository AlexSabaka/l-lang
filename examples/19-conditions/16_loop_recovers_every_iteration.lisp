;; D47's canonical use case (parse-and-recover): a loop whose body signals, recovered per iteration by a
;; handler that invokes a restart established INSIDE the loop -- the pattern try/catch structurally cannot
;; express, because unwinding to a catch would abandon the whole loop. C-native; JS refuses (LL0108).
;;
;; This is also the re-arm stress test: the handle frame is recovered THREE times, so ll_signal's pad must
;; restore the frame's `active` guard on every transfer. Hand-derived from D47: each iteration signals,
;; the handler invoke-restarts :sub 7, the arm yields 7 and the loop continues. Expected: 7, 7, 7.
;; (A frame left inert after the first recovery would print 7 then -1 then -1.)
(
    (defclass Alert :extends Error (let :ctor message))
    (fn attempt [] -> Int (
        (restart-case
            ((signal (Alert "x")) (return -1))
            (:sub [v] v))
    ))
    (handle
        ((for :each i :from [0 1 2] :then (
            (console.log (attempt))
        )))
        (:on Alert [] (invoke-restart :sub 7)))
)

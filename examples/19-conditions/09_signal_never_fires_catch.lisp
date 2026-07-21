;; D47 mechanism separation: a signal is NOT an exception. `signal` never unwinds and never consults
;; CATCH frames, so a try/catch wrapped around the signal point must NOT fire -- even while a handler
;; runs and even after every handler declines. C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: the handler runs IN PLACE (prints first), declines -> signal yields nil, and
;; control resumes AT THE SIGNAL POINT inside the try, so the next statement runs normally. The catch
;; arm is unreachable. Expected: handler, null, after signal.
(
    (defclass Alert :extends Error (let :ctor message))
    (handle
        ((try
            ((console.log (signal (Alert "x")))
             (console.log "after signal"))
            catch e (console.log "CATCH FIRED -- BUG")))
        (:on Alert [] (console.log "handler")))
)

;; D47 end-to-end: handle + signal + invoke-restart -- the parse-and-recover arc. The handler runs IN
;; PLACE at the signal point (its print lands BEFORE the recovered value's), transfers to a restart
;; INNER to the handle frame, and the recovered frame must stay armed for the NEXT signal (ll_signal's
;; re-arm pad restores `active` as the transfer crosses the signal point). C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47 (JS is NOT the oracle):
;;   (parse-num true)  -> body yields 42, no signal                                      -> 42
;;   (parse-num false) -> bad-path signals ParseError -> handler prints the message IN
;;                        PLACE, then invoke-restarts :use-default 0 -> arm binds v=0    -> bad digit, 0
;;   (parse-num false) -> the SAME handle frame handles again -- a stale-inert frame
;;                        would decline -> signal nil -> bad-path returns -1             -> bad digit, 0
(
    (defclass ParseError :extends Error (let :ctor message))

    (fn bad-path [] -> Int (
        (signal (ParseError "bad digit"))
        (return -1)
    ))

    (fn parse-num [ok] -> Int (
        (restart-case
            (if ok 42 (bad-path))
            (:use-default [v] v))
    ))

    (handle
        ((console.log (parse-num true))
         (console.log (parse-num false))
         (console.log (parse-num false)))
        (:on ParseError [e]
            (console.log (e.message))
            (invoke-restart :use-default 0)))
)

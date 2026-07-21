;; A `return` inside a restart-case body must pop the LL_RESTART frame (restore ll_handler_top), or a later
;; unwind would jump into a dead C frame. Pins the emitter's tryStack discipline for restart-case. C-native;
;; JS refuses (LL0108).
;;
;; Hand-derived from D47: the body `(return 7)` returns from `f` directly (the arm is never invoked); the
;; restart frame is popped on the way out. Expected: 7.
(
    (fn f [] -> Int (
        (restart-case
            (return 7)
            (:r [] 0))
    ))
    (console.log (f))
)

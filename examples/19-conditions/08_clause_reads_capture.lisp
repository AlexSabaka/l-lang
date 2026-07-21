;; D47 handler closure conversion: the clauses of one handle share ONE captured environment (the frame
;; has a single henv). `tag` (immutable) is captured by value; `count` (a mut the clause ASSIGNS) must
;; become a heap cell shared with the frame -- without the cell analysis extension the clause would
;; mutate a dead install-time snapshot and the final count would print 0. The binder `c` carries the
;; condition into the clause (field read). C-native; JS refuses (LL0108).
;;
;; Hand-derived from D47: each signal runs the clause in place -> prints `{tag} {message}` and bumps
;; count; both decline (fall off the end). After the handle, count has been bumped twice.
;; Expected: seen: a, seen: b, 2.
(
    (defclass Alert :extends Error (let :ctor message))
    (fn run [] (
        (let tag "seen:")
        (mut count 0)
        (handle
            ((signal (Alert "a"))
             (signal (Alert "b")))
            (:on Alert [c]
                (console.log '"{(tag)} {(c.message)}")
                (count := (+ count 1))))
        (console.log count)
    ))
    (run)
)

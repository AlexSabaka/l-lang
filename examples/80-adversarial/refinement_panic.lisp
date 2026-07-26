;; The SAD path of a D46 `:satisfies` refinement (P3c-1b-ii): a value that violates the declared
;; range PANICS at the boundary into the newtype. A contract breach is a bug, not a catchable error,
;; so there is deliberately no `try` around it -- the process dies. The recoverable path is a future
;; D47 RefinementViolation signal.
;;
;; This is the corpus's first `.panic` example: the sibling `.panic` file holds the message stderr
;; must carry, and `.expect` holds the stdout produced BEFORE the process dies. Both backends agree
;; on the message and disagree on the envelope (JS throws with a stack trace, C fprintf + exit 1),
;; which is exactly why the panic form matches a substring of stderr rather than all of it.
(
    (deftype uint8 <- Int :satisfies (0 .. 255))

    ;; In range: flows through untouched, and prints. Everything up to the panic is still graded.
    (let ok <- uint8 255)
    (console.log "in range:" ok)

    ;; One past the top bound. The check is at the let-init boundary, so this is where it dies --
    ;; nothing below this line runs.
    (let boom <- uint8 256)
    (console.log "unreachable:" boom)
)

;; ADVERSARIAL: `cond` with a one-armed `if` as a clause body (finding CF2, l-lang-ex
;; tetris + minesweeper -- the audit's headline silent bug, sighted in TWO games).
;;
;; `cond` lowers to an if/else-if chain; a clause body used to be emitted BRACE-LESS, so a
;; body that is itself a one-armed `if` left a dangling `else` that captured every LATER
;; clause. `dispatch "a"` would wrongly return "default"; `dispatch "b"`/"z" wrongly "none".
;; FIXED at HEAD (each clause now stands alone). This is the shape of every keyboard handler,
;; so it guards a construct every program writes.
(
  (fn dispatch [k <- String] -> String
    (mut log "none")
    (cond
      ((== k "a") (if false (log := "A-fired")))   ;; one-armed if: must NOT eat later clauses
      ((== k "b") (log := "B-fired"))
      (true       (log := "default")))
    (return log))
  (console.log (dispatch "a"))   ;; none    (clause "a" matched; its one-armed if is false)
  (console.log (dispatch "b"))   ;; B-fired
  (console.log (dispatch "z"))   ;; default
)

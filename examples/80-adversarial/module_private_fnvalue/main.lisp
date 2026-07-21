;; ADVERSARIAL (regression guard): two imported modules whose module-PRIVATE names collide, where the
;; colliding name is used as a FUNCTION VALUE rather than called directly.
;;
;; The sibling guard module_private_collision/ covers the direct-call and constant paths. This one
;; covers the third: `(apply-fn label)` passes `label` as a value, which the C backend resolves
;; through `functionValue` -- a path that looked the name up in `topLevelFns` by its bare spelling,
;; so whichever module was lowered first won and both lines printed its answer.
;;
;; `apply-fn` is ALSO private and duplicated, so the guard fails if either the value path or the
;; direct-call path regresses.
(
    (import "./alpha.lisp")
    (import "./beta.lisp")

    (console.log (alpha-run))
    (console.log (beta-run))
)

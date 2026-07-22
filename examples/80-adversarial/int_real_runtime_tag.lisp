;; ADVERSARIAL (parity guard -- C-correct, JS-wrong): the runtime can tell an Int from a Real.
;;
;; D43 rules that the STATIC type decides and the runtime never votes -- but where the checker has no
;; type, something must still answer. On JS that something is `__ll_is_type`, whose `case 'int'` and
;; `case 'real'` are the IDENTICAL test (`typeof val === 'number'`), because JS has one number type.
;; Its own comment says so at length, and concludes "there is no runtime answer to buy here".
;;
;; D51 buys it. With Int as a BigInt, `typeof` separates them for the first time, and two things that
;; have always been wrong become right:
;;
;;   * `(x :of Int)` on a value whose static type is unknown. Today it answers TRUE for a Real,
;;     because both are 'number'. `tree-sum` in 01-functions/02_recursion leans on this arm.
;;   * Operator-overload dispatch. `__ll_op_registry.lookup` has no static type to consult, so an
;;     `[a <- Int]` overload and an `[a <- Real]` one are indistinguishable and the FIRST registered
;;     wins. That collapse is pre-existing and documented; here it is pinned.
;;
;; EXPECTED == golden. ACTUAL under JS today: the `:of Real` line answers `true` for an Int and the
;; overload dispatch takes the wrong arm.
(
    ;; `probe` is untyped, so `:of` cannot be folded from the channel and reaches the runtime test.
    (fn probe [x] -> String (
        (if (x :of Int) (return "Int"))
        (if (x :of Real) (return "Real"))
        (return "other")
    ))

    (console.log "probe 5:    " (probe 5))
    (console.log "probe 5.5:  " (probe 5.5))
    (console.log "probe str:  " (probe "s"))
)

;; ADVERSARIAL: ERASING A TYPE MUST NOT CHANGE THE ARITHMETIC.
;;
;; `binopMode` returned "real" for `/` BEFORE it checked for a boxed operand -- the one arithmetic
;; operator that narrowed an Unknown, and it narrowed it unconditionally. So the same expression
;; answered differently depending on whether its operands happened to keep their static types:
;;
;;     (/ 7 2)  statically Int/Int   ->  3      (D49d, ll_idiv)
;;     (/ 7 2)  through an Unknown   ->  3.5    (ll_unbox_real on an LL_INT)
;;
;; `+`, `-` and `*` beside it all fall to `ll_op_*`, which dispatches on the runtime TAG and preserves
;; int-ness. Only `/` did not, and `%` did so only when the divisor was non-zero -- which is how the
;; 2026-07-27 audit found the corner of this that it recorded: `(/ 1 0)` on boxed Ints yielded
;; `Infinity` instead of the panic D85 ruled. The Infinity was a symptom; the wrong QUOTIENT is the
;; defect, and it is a silent wrong answer on the REFERENCE backend.
;;
;; THIS FILE IS GRADED ON C ONLY, and the reason is measured rather than asserted. On the deprecated
;; backend `.length` is a host Number at run time while its own checker types it Int, so JS
;; contradicts ITSELF on the two spellings below -- 0 statically, 0.5 through the lambda. C now agrees
;; with itself, and with D49d, in both. Frozen by D66; recorded in the manifest.
(
    ;; -- the two spellings of one division ----------------------------------------------------------
    ;;
    ;; `thru` is the type eraser: an untyped parameter, so its result is an Unknown holding whatever
    ;; the caller passed. Nothing about the VALUE changes -- only what the checker can still say.

    (fn thru [x] (return x))

    (console.log "static 7/2 :" (/ 7 2))
    (console.log "erased 7/2 :" (/ (thru 7) (thru 2)))

    (console.log "static 7%2 :" (% 7 2))
    (console.log "erased 7%2 :" (% (thru 7) (thru 2)))

    ;; A quotient that is exact either way, as the control: if these two disagreed the eraser itself
    ;; would be the thing under suspicion rather than the operator.
    (console.log "static 8/2 :" (/ 8 2))
    (console.log "erased 8/2 :" (/ (thru 8) (thru 2)))

    ;; -- `.length` is an Int (D52), which is what made this reachable from ordinary code ------------
    ;;
    ;; This is the shape that broke `01-functions/04_pipelines.lisp`: a length divided by a literal,
    ;; with a lambda in between. The static spelling has always answered 0 on both backends.

    (let s "hello")
    (console.log "static len/10:" (/ s.length 10))
    (console.log "erased len/10:" (/ (thru s.length) 10))

    ;; -- REAL division is untouched, exactly as D85 scoped it ---------------------------------------
    ;;
    ;; Only the case where BOTH runtime tags are Int changes. A Real on either side still divides as
    ;; IEEE 754 does, including at zero, and `(/ 1.0 0.0)` is `Infinity` on both backends by ruling.

    (console.log "real   7/2 :" (/ 7.0 2.0))
    (console.log "erased 7/2.:" (/ (thru 7) (thru 2.0)))
    (console.log "real   1/0 :" (/ 1.0 0.0))

    ;; -- and a zero divisor on the ERASED path now panics, which is why it is not exercised here ----
    ;;
    ;; D85 puts a zero integer divisor on the CONTRACT side of D82's line: `ll_idiv` does its own
    ;; `fprintf` + `exit` and never routes through the catchable `ll_trap`, so there is nothing a
    ;; program can write here to observe it and keep running. `90-diagnostics` holds the static half
    ;; (LL0244 on a literal zero); the runtime half is a panic by ruling, and a panic ends the file.
    (console.log "done")
)

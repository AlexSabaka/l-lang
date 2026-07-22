;; CONFORMANCE guard: binding a lambda does NOT name it (D55 / FLOOR.md 3.5).
;;
;;     (let g (fn [a b] (+ a b)))
;;     (console.log g)          ->  #<fn>        on both backends
;;
;; JS used to print `#<fn g>` here. That name came from ECMA-262 NamedEvaluation, which gives an
;; anonymous function expression the name of the binding it is assigned to -- the HOST naming a value
;; the language never named. D55 rules the display format to be l-lang's own rather than whatever the
;; host reports, so C's `#<fn>` was right and JS was reporting a guess.
;;
;; The fix was to stop reading `Function.name` at all, which was only possible once every function the
;; language DOES name carries `__ll_name`: a top-level declaration gets a stamp at the front of the
;; program body, and a nested or inlined-imported one gets an inline `Object.assign` at its own
;; expression site. With that complete, a function value arriving at the formatter WITHOUT a name is
;; one the language did not name, and `#<fn>` is the honest answer rather than a lost one.
;;
;; The control this must not break is `01-functions/01_closures.expect`, whose `#<fn increment>` is a
;; NESTED named function -- exactly the case the host name used to cover and the inline wrap now does.
(
    (let g (fn [a b] (+ a b)))
    (console.log "bound lambda:  " g)
    (console.log "nested in vec: " [g])

    ;; A control that must NOT move: an anonymous lambda that is never bound has no name anywhere.
    (console.log "inline lambda: " [(fn [x] x)])
)

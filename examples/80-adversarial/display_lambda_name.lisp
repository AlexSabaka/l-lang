;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): does BINDING a lambda NAME it?
;;
;; The one facet of the display source-name work that is a language RULING rather than a bug, so it is
;; listed rather than fixed.
;;
;;     (let g (fn [a b] (+ a b)))
;;     (console.log g)          JS: #<fn g>      C: #<fn>
;;
;; Nothing in l-lang named that function. JS's answer comes from ECMA-262 NamedEvaluation, which gives
;; an anonymous function expression the name of the binding it is assigned to -- a HOST rule, and D55
;; is explicit that the display format is l-lang's own rather than whatever the host does. On that
;; reading C is right and the fix is to drop the fallback.
;;
;; But the fallback is load-bearing for a different case: a nested `(fn increment [] ...)` gets no
;; `__ll_name` stamp (it is not a top-level declaration and does not hoist to where the stamp is
;; emitted), and its host name IS its source name because nothing needed encoding. Dropping the
;; fallback regressed `01_closures.expect` from `#<fn increment>` to `#<fn>`. So the two cases are
;; entangled, and separating them means either stamping nested declarations too or ruling that a
;; bound lambda is named.
;;
;; The bug half is fixed and guarded in `display_source_names/`: a kebab-case function and an imported
;; one both print their SOURCE name on both backends now, instead of `#<fn my2dkebab2dfn>` and
;; `#<fn __ll_inlined__double_1>`.
;;
;; EXPECTED == golden, which takes C's answer. ACTUAL under JS today: `#<fn g>` on both lines.
(
    (let g (fn [a b] (+ a b)))
    (console.log "bound lambda:  " g)
    (console.log "nested in vec: " [g])

    ;; A control that must NOT move: an anonymous lambda that is never bound has no name anywhere.
    (console.log "inline lambda: " [(fn [x] x)])
)

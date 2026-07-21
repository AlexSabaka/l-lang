;; ADVERSARIAL (regression guard): a module-level CONSTANT of an imported module, read from the
;; importer AND read from inside that module's own lowered function body.
;;
;; The C backend lowers an imported function's BODY on demand (`lowerImportedFunction`) and hoists an
;; imported module-level binding to a C global (`ensureImportedValue`). The second was wired into the
;; plain-identifier read path but NOT into the dotted-head path, so `(DIGITS.indexOf c)` inside a
;; lowered body emitted a bare `u_DIGITS` that no C scope declared -- the file compiled and then `cc`
;; failed with "use of undeclared identifier". Nothing in the corpus caught it, because no C-passing
;; example had ever read an imported module-level constant: std/math's E/PI/TAU exist but were never
;; reached from a C path.
;;
;; This guard exists so that coverage is DELIBERATE rather than incidental. lib/std/io's digit table
;; happens to exercise the dotted-head shape today, but that is an implementation detail of `print`
;; and would vanish the moment io.lisp is rewritten.
;;
;; Both shapes, so a regression in either one is loud:
;;   PLAIN READ  -- `PI` / `TAU` as an ordinary identifier in the importer.
;;   DOTTED HEAD -- `(GREETING.toUpperCase)`, the shape that was actually broken.
;;   DERIVED     -- `TAU` is `(* 2 PI)`, i.e. one imported constant whose initializer reads another,
;;                  which pins the ORDER the hoisted initializers run in.
(
    (import "std/math")
    (import "std/io")

    ;; A local module-level constant reached as a dotted head, for contrast: this shape always
    ;; worked, because a binding of the module being compiled is hoisted by the module-global pass.
    (let GREETING "ready")

    (console.log "PI:" PI)
    (console.log "TAU:" TAU)
    (console.log "TAU = 2PI:" (== TAU (* 2 PI)))
    (console.log "shout:" (GREETING.toUpperCase))

    ;; `print` itself: its body reads lib/std/io's own module-level digit table through a dotted
    ;; head, so this line is the original failing case, reduced.
    (print "{0} and {1}" "one" "two")
)

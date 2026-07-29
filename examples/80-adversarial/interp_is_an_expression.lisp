;; CONFORMANCE guard: an INTERPOLATION IS AN EXPRESSION, and it must mean the same thing as itself.
;;
;; `'"...{expr}..."` was the one place in the language where that was not true. The checker's
;; `formatted-string` case returned `String` -- correct -- but returned it WITHOUT DESCENDING, so no
;; `{...}` segment was ever inferred. Since the checker's reports ride inference, none was ever
;; checked either: `'"{(f 1 2 3)}"` on a one-parameter `f` compiled clean, and so did an undefined
;; name, a String passed where an Int was declared, and a name this file's import list never bound.
;; (That last one is how it was found -- a program that imported `{ nothing-of-this-name }` from a
;; module and then used a binding it had never asked for, with no diagnostic anywhere.)
;;
;; The silence was the smaller half. A node inference never reaches carries NO TYPE, and three
;; separate rulings decide REPRESENTATION from exactly that type. So the same expression meant
;; different things depending on whether it was written inside quotes -- which is what this file
;; measures, one ruling per pair:
;;
;;   D51  (+ 9007199254740992 1)   Int is a wrapping int64        untyped -> f64, and lossy
;;   D51  (nums.includes 2)        the literal crosses as an Int  untyped -> host Number vs BigInt
;;   D49d (/ 7 2)                  Int / Int truncates            untyped -> REAL division
;;
;; The first two were JS-only, so a parity guard could in principle have caught them -- indeed the
;; second is `native_search_numeric.lisp`'s bug, reachable again by writing the call inside a string.
;;
;; THE THIRD WAS WRONG ON BOTH BACKENDS. C reads the same missing static types and makes the same
;; choice, so `3.5` came out of a green suite on both sides and no amount of cross-backend grading
;; would ever have found it. Parity is not correctness: two implementations reading one absent fact
;; agree perfectly, and are both wrong. That is the argument for fixing this in the CHECKER, above
;; the point where the backends diverge, rather than in either runtime.
;;
;; Every line below prints the plain form and the interpolated form of the same expression. The file
;; passes only when each pair agrees, which is the property that has to survive.
(
    ;; -- D51: an Int is a wrapping 64-bit integer, exact past 2^53.
    (console.log "int64 plain: " (+ 9007199254740992 1))
    (console.log f"int64 interp: {(+ 9007199254740992 1)}")

    ;; -- D51 at the host boundary: the literal must cross as an Int, not a host Number.
    (let nums [1 2 3])
    (console.log "includes plain: " (nums.includes 2))
    (console.log f"includes interp: {(nums.includes 2)}")

    ;; -- D49d: Int / Int is integer division, decided by the STATIC types of the operands.
    (console.log "intdiv plain: " (/ 7 2))
    (console.log f"intdiv interp: {(/ 7 2)}")

    ;; Deliberately NOT measured here: a CONTAINER in an interpolation. C's interpolation lowers
    ;; through `ll_to_string_sb` (a comma-join) and never reaches `ll_inspect_sb`, so `{(nums)}` is
    ;; `1,2,3` there against `[1 2 3]` here. That is FLOOR.md 5.2's cluster 2, still open on the C
    ;; side, and it already has its own guard -- `interp_container_format.lisp`. Repeating it would
    ;; make this file C-red for a reason that has nothing to do with what it measures.
)

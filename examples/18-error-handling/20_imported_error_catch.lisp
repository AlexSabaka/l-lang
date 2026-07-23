;; CONFORMANCE guard (E1): catching an IMPORTED error class by its type, on both backends.
;;
;; A `catch :of Rejected` where Rejected is defined in another module used to be JS-broken: the
;; catch filter emitted `instanceof Rejected` -- the SOURCE name -- while the import inliner had
;; renamed the class to `__ll_inlined_Rejected_1`, so it was a ReferenceError. The boolean
;; `(x :of Rejected)` guard was fine, because it lowers to `__ll_is_type(v, "Rejected")` -- a test
;; by NAME against `static __ll_name`, which the inlined class still carries. The fix makes the catch
;; filter use `__ll_is_type` too. C single-level already worked (`ll_iter`-style name-chain walk).
;;
;;   1. catch by the imported type itself.
;;   2. catch by the ROOT (Error) -- must still match a typed throw.
;;   3. the success path returns normally.
(
    (import "20_imported_error_lib.lisp")

    (try (parse-or-throw "x")
         catch e :of Rejected (console.log "1 caught-typed" e.message))

    (try (parse-or-throw "y")
         catch e :of Error (console.log "2 caught-root" e.message))

    (console.log "3 ok" (parse-or-throw "42"))
)

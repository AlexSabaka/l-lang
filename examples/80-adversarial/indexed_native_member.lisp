;; ADVERSARIAL: A NATIVE member on an INDEXED receiver -- and the oracle is the one that is wrong.
;;
;; `(rows[1].length)` is the same shape as `indexed_method_call.lisp` pins for user classes: the callee
;; is an `indexer` whose chain ends in a dotted member, so D1 makes it a CALL. The difference is where
;; the member lives -- `length` and `toUpperCase` are NATIVE, not user methods, so the receiver's C
;; type decides the lowering rather than a class table.
;;
;; GRADED ON C ONLY, and the reason is measured. The JS backend emits the member as an ordinary
;; property and then CALLS it:
;;
;;     console.log("native:", __ll_index(rows, 1)["length"]());
;;     TypeError: __ll_index(...).length is not a function
;;
;; which is a codegen bug in the deprecated backend (D66 freezes it), not a disagreement about what the
;; program means. The user-class cases in the sibling file agree on both backends, so the split is not
;; "this whole feature diverges" -- it is exactly the native-member half.
;;
;; This file exists because the C lowering that closed `computed-callee` covers both halves, and only
;; one of them can be differentially tested.
(
    ;; `.length` on an indexed VECTOR. Answered `ELL0106 computed-callee` before the fix.
    (let rows [[1 2 3] [4 5]])
    (console.log "vec length :" (rows[1].length))

    ;; `.length` on an indexed STRING answers in CHARACTERS (D52), so the two `.length`s reach
    ;; different runtime accessors off the same syntax.
    (let strs ["hello" "hi"])
    (console.log "str length :" (strs[0].length))

    ;; And a native METHOD, which takes the accessor path rather than the field one.
    (console.log "str method :" (strs[1].toUpperCase))
    (console.log "done")
)

;; CONFORMANCE guard: an IMPORTED class displays under its SOURCE name (D55 / FLOOR.md 3.5).
;;
;; `(console.log m)` where `m` is a `Money` imported from another module printed
;;
;;     __ll_inlined_Money_1{:amount 5 :currency "USD"}
;;
;; on JS -- the MANGLER's name, a compiler internal, in user-facing output -- against `Money{...}` on
;; C. Not a formatting nicety: the language was showing a reader a symbol that appears nowhere in
;; their source and that changes with unrelated edits to the module graph.
;;
;; The cause is one character of indirection. `__ll_name` is stamped STATIC, i.e. on the constructor;
;; `__ll_class_tag` read it off the INSTANCE, where it is never present, so it always fell through to
;; `constructor.name` -- which is the inlined binding's name. Both `type` and `__ll_is_type` already
;; get this right and carry a comment explaining why (the "Zh" fix). Fc reintroduced it by writing a
;; third copy from scratch instead of following the two that were correct.
;;
;; A same-module class cannot catch it: its `constructor.name` IS the source name, so the wrong read
;; and the right one agree. The import is the discriminator, which is why this guard is a directory.
(
    (import "./money")

    (let m (Money 5 "USD"))
    (console.log m)

    ;; Nested, so the tag is also exercised where the value is not the top-level argument.
    (console.log [m])
    (console.log {:held m})

    ;; A plain map has NO tag -- the prototype check must not start inventing one.
    (console.log {:amount 5 :currency "USD"})
)

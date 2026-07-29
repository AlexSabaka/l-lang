;; ADVERSARIAL: D1 ASKS WHAT A NAME DENOTES, NOT WHERE IT IS BOUND.
;;
;; `(f)` is a CALL when `f` names a function and a READ otherwise. Three places in the compiler answer
;; that question, and one of them was asking a different one:
;;
;;   `classifyCall.isFunction`      -- is the name declared a function / typed as one?   correct
;;   `resolveFreeCall`, local arm   -- calls through the closure at any arity            correct
;;   `resolveCall`, local arm       -- "is it a LOCAL?" -> read, for every local         WRONG
;;
;; The third only runs where the HIR left a raw list for the backend to re-drive -- and A PIPELINE HEAD
;; IS EXACTLY THAT. `((mk) |> f)` desugars to a core `call` node whose ARGUMENT is the untouched list
;; `(mk)`, so the head was classified by the out-of-step rule. A top-level `mk` took the top-level-
;; function branch and CALLED; a nested one took the local branch and yielded THE CLOSURE ITSELF.
;;
;; Measured before the fix, with the same program twice:
;;
;;     top-level `mk`  ->  3            nested `mk`  ->  ELL0106 `cast:closure->vec`
;;
;; and where the stage was untyped it was not even a refusal -- `TypeError: expected a number`, at run
;; time, from a function that had never been called. JS was right throughout, so this was a backend
;; divergence on top of a defect.
;;
;; NOTHING TO DO WITH GENERATORS OR PIPELINES AS SUCH. The head is the only position that reaches the
;; re-drive; the same closure called directly, or bound and then piped, always worked. That is why
;; `nested_generator.lisp` uses the raw `iter`/`next` cursor and says so -- it was written around this.
(
    (fn len [xs <- Int[]] -> Int (return xs.length))
    (fn dbl [n <- Int] -> Int (return (* n 2)))

    ;; -- the case that broke: a NESTED function as the head ------------------------------------------

    (fn nested-head [] -> Int (
        (fn mk [] -> Int[] (return [4 5 6]))
        (return ((mk) |> len))))
    (console.log "nested fn head    :" (nested-head))

    ;; -- and a let-bound LAMBDA as the head, which is the same rule reached by another spelling ------

    (fn lambda-head [] -> Int (
        (let mk (fn [] -> Int[] (return [1 2 3 4 5])))
        (return ((mk) |> len))))
    (console.log "lambda head       :" (lambda-head))

    ;; -- more than one stage, so a fix that repaired only the first hop is visible -------------------

    (fn multi [] -> Int (
        (fn mk [] -> Int[] (return [1 2 3]))
        (return ((mk) |> len |> dbl))))
    (console.log "multi-stage       :" (multi))

    ;; -- D1'S OTHER HALF MUST NOT MOVE ---------------------------------------------------------------
    ;;
    ;; `(n)` where `n` is not a function is redundant parens around a value, and stays a READ. The fix
    ;; is gated on the local's C type being a closure for exactly this reason: a local that MIGHT hold
    ;; a function at run time but is boxed stays a read too, because narrowing it would be a guess and
    ;; D1's read is the answer when the question cannot be settled statically.

    (fn plain-local [] -> Int (
        (let n 9)
        (return ((n) |> dbl))))
    (console.log "non-function local:" (plain-local))

    ;; -- the control: a TOP-LEVEL head, which took the other branch and always worked ----------------

    (fn top-mk [] -> Int[] (return [7 8]))
    (console.log "top-level head    :" ((top-mk) |> len))
    (console.log "done")
)

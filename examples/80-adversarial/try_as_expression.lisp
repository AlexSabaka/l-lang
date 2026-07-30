;; D110: a `try` IS AN EXPRESSION, its value comes from the try block or a catch arm and NEVER from
;; `finally`, and a `try` with neither catch nor finally is the OPTIONAL TRY -- the block's value, or
;; nil if it threw, typed `T?`.
;;
;; Three separate things were wrong or missing, and the first is why the others could not be stated:
;;
;;   1. A `try` EXPRESSION WAS UNTYPED. `InferTypesAstVisitor` had no case for it, so its type was
;;      Unknown and the checker turned off for whatever it was assigned to. Measured against a
;;      control: `(let a <- String (risky 5))` is LL0200, and the same annotation over a `try` was
;;      SILENT. That is the third time this exact hole has been found in that file -- `if`'s
;;      condition, then `match`'s arms, now this.
;;   2. `(try e)` was refused outright by LL0007, so the optional form was unwritable.
;;   3. Its type had to be `T?`, which falls out of (1) once the bare form desugars to a nil-yielding
;;      catch arm -- `findCommonType([T, Nil])`.
;;
;; The value rows below were ALREADY correct before D110 and are pinned here because nothing guarded
;; them: a change to the lowering could have silently made `finally` win.
(
    (fn risky [n <- Int] -> Int (
        (if (< n 0) (throw (new ValueError "negative")))
        (return (* n 2))))

    ;; -- the value comes from the TRY block ---------------------------------------------------------
    (let a (try (risky 5) catch e -1))
    (console.log "try arm:" a)

    ;; -- ...or from the CATCH arm ------------------------------------------------------------------
    (let b (try (risky -1) catch e -1))
    (console.log "catch arm:" b)

    ;; -- and NEVER from `finally`, which runs for its effect only. If this ever prints 99 the
    ;;    lowering has started folding the finalizer into the value.
    (let c (try (risky 5) catch e -1 finally 99))
    (console.log "finally never wins:" c)

    ;; -- `finally` still RUNS, and after the try block ----------------------------------------------
    (mut order "")
    (let d (try ((order := (+ order "T")) 7) finally (order := (+ order "F"))))
    (console.log "finally ran:" d order)

    ;; -- THE OPTIONAL TRY: no catch, no finally ------------------------------------------------------
    (console.log "optional, success:" (try (risky 5)))
    (console.log "optional, threw:" (try (risky -1)))

    ;; -- and its result NARROWS (D9), which is what makes the form worth having ----------------------
    (let e (try (risky 21)))
    (if (!= e nil)
        (console.log "narrowed:" (* e 2))
        (console.log "was nil"))

    ;; -- a `try` with a `finally` but NO catch still PROPAGATES. Catch is what handles; finally is
    ;;    cleanup. So the bare form is a distinct form rather than a degenerate case, and this row is
    ;;    the one that says so: if it ever prints "swallowed" the two have been conflated.
    (mut cleaned "no")
    (try
        ((try ((cleaned := "yes") (risky -1)) finally (cleaned := (+ cleaned "!")))
         (console.log "swallowed -- WRONG"))
      catch outer :of ValueError (console.log "propagated past finally:" cleaned))
)

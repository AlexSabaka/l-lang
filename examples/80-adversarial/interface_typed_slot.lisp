;; CONFORMANCE guard: an INTERFACE-typed slot is a CONTRACT, not a layout.
;;
;; `iteration_protocol.lisp`'s own header lists three C-backend breakages the protocol work fixed, and
;; the third one is:
;;
;;     (fn f [c <- Iterable<Int>] ...)   C: compiled, then `ll_unbox_vec` TRAPPED at run time
;;
;; That guard never tests it. Its body covers a hand-written Iterable, a string, the raw cursor and an
;; array -- the two emitter crashes and the control -- and the PARAMETER case, the one that "compiles
;; clean and dies on data," went unguarded. This file is that missing case.
;;
;; IT PASSES, and that is the point: this guard was written expecting RED and came back GREEN. The
;; prediction was that `mapType`'s shared `class | struct | interface` arm (ctype.ts) would give an
;; interface-typed slot `{k:"obj"}` -- a LAYOUT, `ll_obj*` -- so an ARRAY reaching that slot would make
;; P2 mint a `c-cast vec -> obj` the emitter cannot write. What actually happens is that the arm is
;; never reached: the symbol table does not hand back `kind:"interface"` for these annotations, and
;; `typeNodeToCType` cannot resolve `Iterable` either (interfaces are erased, D24, so `classes.has`
;; is false and `ensureClassRegistered` only knows structs and classes). Both channels return nothing
;; and `declareParam` falls through to boxed. The emitted signature is `u_count_2dall(ll_value)`.
;;
;; So the right CType arrives for the wrong reason -- by two lookups failing rather than by a decision.
;; That is worth pinning precisely BECAUSE it is accidental: nothing states the invariant, so anyone
;; who later teaches `ensureClassRegistered` about interfaces, or makes the checker report a real
;; interface type here, would silently turn every interface-typed slot into an `ll_obj*` claim and
;; break the shapes below. The invariant is: an interface names a CONTRACT, not a layout. An array is
;; Iterable, and after Phase G a generator is too; neither is an `ll_obj`. Conformance is a run-time
;; question, which is where `ll_iter` and `ll_dyn_method` already answer it.
;;
;; This is NOT a generator change. It sits underneath one: every `std/iter/linq` terminal takes
;; `coll <- Iterable<T>`, so a generator will reach C through exactly this slot.
;;
;; WHAT EACH LINE IS FOR:
;;
;;   1-2. the PARAMETER, reached by two different runtime shapes -- a vec and a nominal conformer.
;;        Only the second is an `ll_obj`; the first is the one a layout claim would break.
;;   3.   the RETURN slot, a separate code path (`userFnRet`) through the same map.
;;   4.   the LET slot -- likewise (`c-decl`'s declCType).
;;   5.   THE CONTROL, and the reason this file is not four lines. A user interface satisfied ONLY
;;        nominally must keep dispatching: a boxed slot means `(g.greet)` goes through `ll_dyn_method`
;;        rather than a statically-typed call, and an "optimisation" that re-typed these slots to
;;        `obj` to recover that call is exactly the change lines 1-4 exist to stop.
;;
;; ONE ASYMMETRY THIS FILE CANNOT TEST, recorded so the next reader does not re-derive it: an ARRAY
;; satisfies `Iterable<T>` in the checker, a STRING does not -- `(count-all "abc")` is ELL0203
;; "expected Iterable<T>, got String" -- even though `for :each` walks both and `ll_iter` has an arm
;; for each. A checker-side gap in structural conformance, unrelated to the CType this guard is about.
(
    (import "std/iter")

    ;; A NOMINAL conformer -- an `ll_obj`, the only shape the old CType could describe.
    (defstruct Countdown :implements Iterable<Int>
        (mut :ctor n <- Int 3)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (<= this.n 0) (return nil))
            (this.n := (- this.n 1))
            (return (+ this.n 1))
        ))
    )

    (fn count-all<T> [coll <- Iterable<T>] -> Int (
        (mut n 0)
        (for :each x :from coll :then (n := (+ n 1)))
        (return n)))

    ;; 1-2. one slot, two runtime shapes.
    (console.log (count-all [10 20 30]))
    (console.log (count-all (Countdown 4)))

    ;; 3. an interface-typed RETURN, handed straight back into an interface-typed parameter.
    (fn pick [] -> Iterable<Int> (return [7 8]))
    (console.log (count-all (pick)))

    ;; 4. an interface-typed LET.
    (let src <- Iterable<Int> [1 2 3 4 5])
    (console.log (count-all src))

    ;; 5. THE CONTROL: nominal-only conformance still dispatches.
    (definterface Greeter
        (fn greet [] -> String)
    )
    (defstruct Robot :implements Greeter
        (let :ctor id <- String)
        (fn greet [] -> String (return f"beep {(this.id)}"))
    )
    (fn hail [g <- Greeter] -> String (return (g.greet)))
    (console.log (hail (Robot "R2")))
)

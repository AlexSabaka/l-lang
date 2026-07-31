;; D11 VALUE SEMANTICS, in the containers `06-value-semantics/` never puts a struct in.
;;
;; That decade's seven files cover the copy sites D11 names outright -- assignment, a parameter, a
;; collection slot, operator purity, interface binding and interface params. None of them puts a
;; struct inside a GENERATOR FRAME, a CATCH ARM, a MAP VALUE, or a LAMBDA, and those are the four
;; places where a copy could be lost without anything saying so.
;;
;; THE GENERATOR ROW IS WHY THIS FILE EXISTS. `promoteFrame` rewrites every binding in a `:gen` body
;; into a slot of `ll_obj.fields[]` -- a BOXED slot, reached by `c-field-get` and written by a field
;; store. That is a different home from a C local, with a different read and a different write, and
;; nothing in the corpus asked whether a struct keeps its value semantics after the move. If it did
;; not, a generator would silently mutate its caller's struct.
;;
;; A LOST COPY IS A SILENT WRONG ANSWER -- no diagnostic, no crash, just a value that changed when the
;; language promised it would not. That is the one failure shape a green gate cannot notice, and it is
;; why this is worth a file with no defect behind it: three passes that decide where a value LIVES
;; were changed today (frame promotion, coercion insertion, the child-rewrite descent), and any of
;; them could turn a copy into an alias without breaking a single existing golden.
;;
;; NO DEFECT WAS FOUND WRITING THIS. Every row already answers correctly on both backends. It is a
;; guard, in the tradition of `setjmp_clobber_shapes.lisp`.
;;
;; EVERY ROW IS THE SAME EXPERIMENT: take a copy, mutate the COPY, print the ORIGINAL. A struct must
;; be unchanged. The class row is the control that says the experiment can detect sharing at all.
(
    (import "std/protocols")
    (defstruct P (mut :ctor n <- Int))
    (defstruct Inner (mut :ctor v <- Int))
    (defstruct Outer (mut :ctor i <- Inner))
    (defclass C (mut :ctor n <- Int))

    ;; 1. THE CONTROL PAIR: a struct is copied, a class is shared. If the class row ever prints 1 the
    ;;    experiment has stopped detecting sharing and every other row below is worthless.
    (let s1 (P 1))
    (mut s2 s1)
    (s2.n := 99)
    (console.log "struct assign:" s1.n)

    (let c1 (new C 1))
    (mut c2 c1)
    (c2.n := 99)
    (console.log "class assign:" c1.n)

    ;; 2. INTO A GENERATOR FRAME -- a boxed frame slot, not a C local.
    (let outer (P 1))
    (fn :gen mutate-local [] -> Iterator<Int> (
        (mut local outer)
        (local.n := 99)
        (yield local.n)))
    (mut seen 0)
    (for :each x :from (mutate-local) :then (seen := x))
    (console.log "gen frame -- original:" outer.n "frame copy:" seen)

    ;; 3. OUT of a generator, ACROSS a suspension. The consumer mutates what it was handed; the
    ;;    generator's own binding must survive untouched into the next resume.
    (fn :gen hand-out [] -> Iterator<Any> (
        (let mine (P 1))
        (yield mine)
        (yield mine.n)))
    (mut round 0)
    (mut after 0)
    (for :each x :from (hand-out) :then (
        (round := (+ round 1))
        (if (== round 1) (x.n := 99) (after := x))))
    (console.log "yielded out, generator's own:" after)

    ;; 4. A MAP VALUE and a VECTOR SLOT -- collection slots the decade covers only for vectors.
    (let m {"k" (P 1)})
    (mut from-map m["k"])
    (from-map.n := 99)
    (console.log "map slot:" m["k"].n)

    (let src (P 1))
    (let v [src])
    (mut from-vec v[0])
    (from-vec.n := 99)
    (console.log "vector slot -- source:" src.n "slot:" v[0].n)

    ;; 5. INSIDE A LAMBDA, which is a lifted C function reading through an env.
    (let captured (P 1))
    (let f (fn [] -> Int ((mut local captured) (local.n := 99) (return local.n))))
    (let got (f))
    (console.log "lambda -- original:" captured.n "local:" got)

    ;; 6. ACROSS A LONGJMP LANDING. `setjmp_clobber_shapes.lisp` pins a struct FIELD written across a
    ;;    landing; this pins that a struct COPY taken in the arm is still a copy.
    (let before (P 1))
    (mut in-arm 0)
    (try ((throw (new ValueError "x")))
      catch e ((mut local before) (local.n := 99) (in-arm := local.n)))
    (console.log "catch arm -- original:" before.n "arm copy:" in-arm)

    ;; 7. A STRUCT INSIDE A STRUCT: the copy must be deep enough to reach the inner value, or two
    ;;    Outers would share one Inner.
    (let o1 (Outer (Inner 1)))
    (mut o2 o1)
    (o2.i.v := 99)
    (console.log "nested struct:" o1.i.v)

    ;; 8. RETURNED from a function -- a fresh call must not see the previous caller's mutation.
    (fn make [] -> P ((let p (P 1)) (return p)))
    (mut r1 (make))
    (r1.n := 99)
    (let r2 (make))
    (console.log "returned, second call:" r2.n)
)

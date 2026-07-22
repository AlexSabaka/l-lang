;; CONFORMANCE guard: D30's iteration protocol works on BOTH backends.
;;
;; `iter` and `next` lived only in the JS shim, on no floor. That is not a bookkeeping detail -- it
;; meant THE C BACKEND HAD NO PROTOCOL AT ALL. `resolveForEach` special-cased vec and str, and the
;; emitter then wrote `ll_vec*` over whatever it was handed, unconditionally. So:
;;
;;   (for :each ch :from "abc")        C: crash, `no cast str -> vec`
;;   (for :each v :from countdown)     C: crash, `no cast obj -> vec`
;;   (fn f [c <- Iterable<Int>] ...)   C: compiled, then `ll_unbox_vec` TRAPPED at run time
;;
;; The first two are uncaught exceptions with bare stack traces rather than diagnostics; the third is
;; worse, because it compiles clean and dies on data. All three are reachable from ordinary code.
;;
;; D29's own ruling had already warned about this shape -- "`for :each` was hardcoded to emit
;; `for...of`, with no protocol behind it" -- which is what the protocol was written to fix. The C
;; backend had reproduced the bug one layer down, and nothing caught it because every green C
;; `for :each` in the corpus iterates an ARRAY.
;;
;; A cursor is a CLOSURE for the built-in sequences and the USER'S OWN OBJECT otherwise, which is what
;; lets `next` stay ignorant: a closure is called, an object is asked for its `next`. No new runtime
;; tag, and nothing a user can accidentally construct -- a 2-element vec used as a cursor would have
;; been indistinguishable from a user's own 2-element vec.
;;
;; ONE THING THIS GUARD DELIBERATELY DOES NOT TEST: iterating a MAP. The first draft of `ll_iter`
;; walked a map's keys, which made C succeed where JS throws `m is not iterable` -- a plain Object has
;; no `Symbol.iterator`. That is a divergence INVENTED while fixing one, and the silent kind. A map is
;; not Iterable until something RULES that it is; until then both backends refuse, and `ll_iter` traps
;; with the JS shim's own wording.
(
    (import "std/iter")

    ;; 1. A hand-written Iterable -- the case that crashed the C emitter. An Iterator IS an Iterable,
    ;;    so `iterator()` answers `this` (D30).
    (defstruct Countdown :implements Iterable<Int>
        (mut :ctor n <- Int 3)
        (fn iterator [] -> Iterator<Int> (return this))
        (fn next [] -> Int? (
            (if (<= this.n 0) (return nil))
            (this.n := (- this.n 1))
            (return (+ this.n 1))
        ))
    )
    (for :each v :from (Countdown 3) :then (console.log "countdown:" v))

    ;; 2. A STRING -- codepoints, per D52, and the other emitter crash.
    (for :each ch :from "abc" :then (console.log "char:     " ch))

    ;; 3. The RAW CURSOR, which is what `iter`/`next` are for: nil MEANS DONE. D9 gives the language
    ;;    one bottom value, which is why the protocol needs no `{value, done}` pair.
    (mut it (iter [10 20]))
    (mut v (next it))
    (while (!= v nil) (
        (console.log "cursor:   " v)
        (v := (next it))
    ))

    ;; 4. An ARRAY still takes the direct index loop -- no cursor, no allocation. The control: if the
    ;;    protocol arm ever swallowed this case, the output would be unchanged and only the emitted C
    ;;    would differ, so this line guards the OTHER arm staying reachable.
    (for :each n :from [1 2] :then (console.log "array:    " n))
)

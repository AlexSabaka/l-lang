;; THE SETJMP-CLOBBER CLASS, in the shapes the existing guard does not cover.
;;
;; C11 7.13.2.1p3: a non-volatile local of the `setjmp`-containing function is INDETERMINATE after a
;; `longjmp` if it was modified in between. `codegen/c/volatiles.ts` marks such locals, and only an
;; OPTIMISED run can falsify that marking -- at `-O0` the reads happen to work whether or not the
;; emission is correct, which is why `npm run test:c:o2` exists. The original defect printed `0/0`
;; for `5/5` at any `-O` above zero, silently, for the whole life of the corpus before it.
;;
;; `18-error-handling/11_try_assign_finally.lisp` pins exactly ONE shape: a mutable SCALAR written in
;; the try and read in the catch and finally. Every row below is a shape it does not reach, and the
;; last three are correct for a DIFFERENT REASON than volatility -- which is the point of pinning
;; them separately:
;;
;;   * a closure-captured local is heap-promoted to a CELL by `computeCellVars`, so it never lives in
;;     the frame the longjmp discards, and `volatile` is irrelevant to it. If cell promotion ever
;;     stopped covering a captured mutable, the scalar guard would not notice.
;;   * a vector and a struct field are boxed values behind a pointer; what must survive the landing is
;;     the POINTER, not the contents.
;;
;; NO DEFECT WAS FOUND WRITING THIS. Every row agrees at -O0 and -O2 today. It is a guard for a class
;; the project's own contract says cannot be falsified any other way.
(
    ;; 1. TWO LANDINGS. An inner catch runs, then an outer one -- the local crosses both.
    (fn nested [] -> Int (
        (mut b 1)
        (try ((try ((b := 7) (throw (new ValueError "inner"))) catch e ((b := (+ b 1))))
              (throw (new ValueError "outer")))
          catch e ((b := (+ b 100))))
        (return b)))

    ;; 2. REPEATED LANDINGS. A try inside a loop lands three times against the same local.
    (fn in-loop [] -> Int (
        (mut c 0)
        (for :init (mut i 0) :cond (< i 3) :step (i := (+ i 1)) :then (
            (try ((c := (+ c 1)) (throw (new ValueError "e"))) catch e ((c := (+ c 10))))))
        (return c)))

    ;; 3. CATCH AND FINALLY BOTH WRITE, after the landing.
    (fn with-finally [] -> Int (
        (mut d 0)
        (try ((d := 1) (throw (new ValueError "x"))) catch e ((d := (+ d 2))) finally ((d := (+ d 4))))
        (return d)))

    ;; 4. A CLOSURE-CAPTURED local, mutated through the closure on both sides of the landing.
    (fn closed [] -> Int (
        (mut a 1)
        (let bump (fn [] -> Void (a := (+ a 10))))
        (try ((bump) (throw (new ValueError "x"))) catch e ((bump)))
        (return a)))

    ;; 5. A NON-SCALAR local -- the pointer must survive, and the mutation before the throw must stick.
    (fn vec-local [] -> Int (
        (mut v [1])
        (try ((v.push 2) (throw (new ValueError "x"))) catch e ((v.push 3)))
        (return v.length)))

    ;; 6. A STRUCT FIELD written across the landing.
    (defstruct Box (mut :ctor n <- Int))
    (fn boxed [] -> Int (
        (let b (Box 1))
        (try ((b.n := 5) (throw (new ValueError "x"))) catch e ((b.n := (+ b.n 1))))
        (return b.n)))

    (console.log "nested:" (nested))
    (console.log "in-loop:" (in-loop))
    (console.log "with-finally:" (with-finally))
    (console.log "closed:" (closed))
    (console.log "vec-local:" (vec-local))
    (console.log "boxed:" (boxed))
)

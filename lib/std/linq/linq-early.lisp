;; std/linq (part 2 of 2) -- the EARLY-EXIT and TERMINAL operators.
;;
;; Same package as `linq.lisp` (Phase M / Mb): `package.yaml` names `std/linq` over `sources:
;; ["*.lisp"]`, so both files are one compilation unit and `(import "std/linq")` yields the union of
;; their exports. This file needs no import of `linq.lisp` -- a package's files share a unit, not a
;; boundary. (It DOES lean on the `iter`/`next` cursor builtins from La, which are language-level.)
(
  ;; ------------------------------------------------------------------------------------------------
  ;; EARLY-EXIT / LOCKSTEP. These cannot use `for :each` -- a `for...of` has no `break` -- so they PULL
  ;; a raw cursor (La's `iter`/`next`) under a `while` and stop the instant they are done. That is what
  ;; makes them safe over an INFINITE source: `(nats |> (take 3))` terminates.
  ;; ------------------------------------------------------------------------------------------------

  ;; take -- the first `n` elements, then stop. One-element lookahead: it may pull one past the last it
  ;; yields, which for a lazy source is produced on demand and harmless.
  (fn :gen take [coll n]
    (let it (iter coll))
    (mut i 0)
    (mut v (next it))
    (while (&& (< i n) (!= v nil)) (
      (yield v)
      (i := (+ i 1))
      (v := (next it)))))

  ;; take-while -- the leading run where (pred x) holds, stopping at the first element that fails it.
  (fn :gen take-while [coll pred]
    (let it (iter coll))
    (mut v (next it))
    (while (&& (!= v nil) (pred v)) (
      (yield v)
      (v := (next it)))))

  ;; zip -- pair elements of `a` and `b` in lockstep as `[x y]`, stopping when EITHER runs out.
  (fn :gen zip [a b]
    (let ia (iter a))
    (let ib (iter b))
    (mut x (next ia))
    (mut y (next ib))
    (while (&& (!= x nil) (!= y nil)) (
      (yield [x y])
      (x := (next ia))
      (y := (next ib)))))

  ;; ------------------------------------------------------------------------------------------------
  ;; TERMINALS. These CONSUME a sequence (not `:gen`) -- they are how a lazy chain becomes a value.
  ;; `to-list` bridges back to an array; the rest collapse the sequence to one result.
  ;; ------------------------------------------------------------------------------------------------

  ;; to-list -- drain the sequence into an array. The usual end of a chain.
  (fn to-list [coll]
    (let out [])
    (for :each x :from coll :then (
      (out.push x)))
    (return out))

  ;; reduce -- fold left with `f`, seeded by `init`.
  (fn reduce [coll f init]
    (mut acc init)
    (for :each x :from coll :then (
      (acc := (f acc x))))
    (return acc))

  ;; count -- how many elements the sequence produces.
  (fn count [coll]
    (mut n 0)
    (for :each x :from coll :then (
      (n := (+ n 1))))
    (return n))

  ;; for-each -- call `f` on each element for its effect; produce nothing.
  (fn for-each [coll f]
    (for :each x :from coll :then (
      (f x))))

  (export take take-while zip to-list reduce count for-each)
)

;; std/linq (part 2 of 2) -- the EARLY-EXIT and TERMINAL operators.
;;
;; Same package as `linq.lisp` (Phase M / Mb): `package.yaml` names `std/linq` over `sources:
;; ["*.lisp"]`, so both files are one compilation unit and `(import "std/linq")` yields the union of
;; their exports. This file needs no import of `linq.lisp` -- a package's files share a unit, not a
;; boundary. (It DOES lean on the `iter`/`next` cursor builtins from La, which are language-level.)
;;
;; Typed + `:extension` like `linq.lisp` (Phase Nd): the receiver is `Iterable<T>`, so these chain
;; method-style (`((coll.take 3).to-list)`) as well as through the pipe. The early-exit ops PRESERVE the
;; element type (`Iterator<T>`); `zip` yields a pair, `Any` until tuples; the terminals return a value.
(
  ;; The iteration protocol these operators are typed over (`Iterable<T>` / `Iterator<T>`).
  (import "std/iter")

  ;; ------------------------------------------------------------------------------------------------
  ;; EARLY-EXIT / LOCKSTEP. These cannot use `for :each` -- a `for...of` has no `break` -- so they PULL
  ;; a raw cursor (La's `iter`/`next`) under a `while` and stop the instant they are done. That is what
  ;; makes them safe over an INFINITE source: `(nats |> (take 3))` terminates.
  ;; ------------------------------------------------------------------------------------------------

  ;; take -- the first `n` elements, then stop. One-element lookahead: it may pull one past the last it
  ;; yields, which for a lazy source is produced on demand and harmless.
  ;; take -- the first `n` elements. Pulls EXACTLY `n` from the cursor (LB1): the pull is INSIDE the
  ;; loop, gated by `i < n`, so the (n+1)th element is never consumed. The old form pulled at the END
  ;; of each iteration and re-tested the count at the START, so it always over-pulled by one and
  ;; silently dropped that element from a shared/stateful cursor.
  (fn :extension :gen take<T> [coll <- Iterable<T> n <- Int] -> Iterator<T>
    (let it (iter coll))
    (mut i 0)
    (while (< i n) (
      (let v (next it))
      (if (== v nil)
        (i := n)          ;; exhausted -- stop without pulling again
        (
          (yield v)
          (i := (+ i 1)))))))

  ;; take-while -- the leading run where (pred x) holds, stopping at the first element that fails it.
  (fn :extension :gen take-while<T> [coll <- Iterable<T> pred] -> Iterator<T>
    (let it (iter coll))
    (mut v (next it))
    (while (&& (!= v nil) (pred v)) (
      (yield v)
      (v := (next it)))))

  ;; zip -- pair elements of `a` and `b` in lockstep as `[x y]`, typed as the tuple `[A B]` (Phase U),
  ;; stopping when EITHER runs out. The two sides may differ (`A`, `B`).
  (fn :extension :gen zip<A,B> [a <- Iterable<A> b <- Iterable<B>] -> Iterator<[A B]>
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
  (fn :extension to-list<T> [coll <- Iterable<T>] -> T[]
    (let out [])
    (for :each x :from coll :then (
      (out.push x)))
    (return out))

  ;; reduce -- fold left with `f`, seeded by `init`. The accumulator type is not recovered (the seed and
  ;; `f` are untyped here), so the result is `Any`.
  (fn :extension reduce<T> [coll <- Iterable<T> f init] -> Any
    (mut acc init)
    (for :each x :from coll :then (
      (acc := (f acc x))))
    (return acc))

  ;; count -- how many elements the sequence produces.
  (fn :extension count<T> [coll <- Iterable<T>] -> Int
    (mut n 0)
    (for :each x :from coll :then (
      (n := (+ n 1))))
    (return n))

  ;; for-each -- call `f` on each element for its effect; produce nothing.
  (fn :extension for-each<T> [coll <- Iterable<T> f] -> Void
    (for :each x :from coll :then (
      (f x))))

  (export take take-while zip to-list reduce count for-each)
)

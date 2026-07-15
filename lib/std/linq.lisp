;; std/linq -- the LAZY SEQUENCE operators (the C# LINQ steal). Phase L.
;;
;; Each operator is a collection-FIRST `:gen` function over the iteration protocol (D30/D31). Two
;; consequences make this the whole design:
;;
;;   LAZY.   `:gen` lowers to `function*`, so an operator does no work until its result is pulled. A
;;           chain builds a pipeline of generators; nothing materialises until a terminal (`to-list`,
;;           or an outer `for :each`) drives it. `(map f)` over a million elements allocates nothing.
;;
;;   PIPED.  Collection-first means the working infix `|>` threads it: `(coll |> (map f) |> (filter p))`
;;           desugars to `filter(map(coll, f), p)` -- left-to-right LINQ, no `:extension` machinery, and
;;           it type-checks (the pipe types as its final stage's return). Collection-first also matches
;;           C#'s `this`-receiver, so the same signatures become extension methods the day `:extension`
;;           is built.
;;
;; UNTYPED, on purpose. Like `std/seq`, these ship without `-> Iterator<T>` annotations: call-site
;; generic inference does not exist yet (Phase 5), so `Iterable<T> -> Iterator<U>` on a free function
;; would only infer Unknown -- documentation with no teeth. They are gradually typed; the chains RUN
;; correctly, which is what laziness needs. When call-site generics land, the annotations go on and the
;; `Iterator<T> :implements Iterable<T>` already in `std/iter` makes the chains check end to end.
;;
;; The EARLY-EXIT operators (`take`, `take-while`, `zip`) live in a follow-up: they cannot use the
;; `for :each` sugar (a `for...of` has no `break`), so they pull a raw cursor with `(iter)`/`(next)`.
(
  ;; map -- produce (f x) for each element.
  (fn :gen map [coll f]
    (for :each x :from coll :then (
      (yield (f x)))))

  ;; filter -- keep the elements satisfying (pred x).
  (fn :gen filter [coll pred]
    (for :each x :from coll :then (
      (when (pred x) :then (yield x)))))

  ;; enumerate -- pair each element with its index as `[i x]` (l-lang has no tuple type; `seq.zip`
  ;; yields 2-element arrays the same way).
  (fn :gen enumerate [coll]
    (mut i 0)
    (for :each x :from coll :then (
      (yield [i x])
      (i := (+ i 1)))))

  ;; concat -- the elements of `a`, then those of `b`.
  (fn :gen concat [a b]
    (for :each x :from a :then ((yield x)))
    (for :each y :from b :then ((yield y))))

  ;; skip -- drop the first `n` elements, produce the rest. A counter, no early exit.
  (fn :gen skip [coll n]
    (mut i 0)
    (for :each x :from coll :then (
      (when (>= i n) :then (yield x))
      (i := (+ i 1)))))

  ;; skip-while -- drop the leading run where (pred x) holds, produce everything from the first failure
  ;; on (including it).
  (fn :gen skip-while [coll pred]
    (mut dropping true)
    (for :each x :from coll :then (
      (when (&& dropping (! (pred x))) :then (dropping := false))
      (when (! dropping) :then (yield x)))))

  ;; flat-map -- map each element to a sequence via `f`, then flatten one level.
  (fn :gen flat-map [coll f]
    (for :each x :from coll :then (
      (for :each y :from (f x) :then (
        (yield y))))))

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

  (export map filter enumerate concat skip skip-while flat-map
          take take-while zip
          to-list reduce count for-each)
)

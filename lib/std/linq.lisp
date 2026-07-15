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

  (export map filter enumerate concat skip skip-while flat-map)
)

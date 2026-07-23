;; std/iter/linq -- the LAZY SEQUENCE operators (the C# LINQ steal). Phase L.
;;
;; This package spans TWO files (Phase M / Mb): the STRAIGHT-THROUGH operators here, and the EARLY-EXIT
;; and TERMINAL operators in `linq-early.lisp`. They are one compilation unit -- `package.yaml` names
;; `std/iter/linq` over `sources: ["*.lisp"]` -- so `(import "std/iter/linq")` brings in the union of both files'
;; exports, and neither file imports the other.
;;
;; The counterpart to `std/seq` (D33): this module is LAZY, collection-FIRST, pipe-surfaced; `std/seq`
;; is EAGER, collection-LAST, functional-order (`(map f coll)` -> array). Both export
;; `map`/`filter`/`reduce`/`zip` -- pick ONE per file (imports are per-file; do not import both). Use
;; `to-list` to turn a lazy chain here back into a `std/seq`-style array.
;;
;; Each operator is a collection-FIRST `:gen` function over the iteration protocol (D30/D31). Two
;; consequences make this the whole design:
;;
;;   LAZY.   `:gen` lowers to `function*`, so an operator does no work until its result is pulled. A
;;           chain builds a pipeline of generators; nothing materialises until a terminal (`to-list`,
;;           or an outer `for :each`) drives it. `(map f)` over a million elements allocates nothing.
;;
;;   TWO SURFACES (Phase Nd). Collection-first means the receiver IS the first parameter, so ONE
;;           definition serves both:
;;             PIPE    `(coll |> (map f) |> (filter p))` desugars to `filter(map(coll, f), p)` -- the
;;                     PRIMARY surface (D33), left-to-right, and it threads an array or a generator alike.
;;             METHOD  `:extension` makes `((coll.map f).filter p)` dispatch to the same free functions
;;                     -- lazy method chaining, C#-style -- when `coll` is a nominal `Iterable`
;;                     (a generator, a hand-written iterator, or `(seq arr)`). A BARE array keeps native
;;                     `.map`/`.filter` (eager); `(seq arr)` opts it into the lazy chain.
;;
;; TYPED (Phase Nd). The receiver is `Iterable<T>` and each transformer returns `Iterator<...>`, so a
;; method chain type-checks hop to hop (`Iterator :implements Iterable`, std/iter). Element types stay
;; loose where inference cannot recover them: an element-CHANGING op (`map`, `flat-map`) returns
;; `Iterator<Any>` (a lambda's return type is not inferred yet); element-PRESERVING ops keep `Iterator<T>`.
;; Arrays satisfy `Iterable<T>` for the pipe's sake, but are NOT a nominal conformer -- that is what keeps
;; `(arr.map f)` on native eager array.map. Gradually typed, all of it RUNS correctly regardless.
(
  ;; The iteration protocol these operators are typed over -- `Iterable<T>` / `Iterator<T>` and the
  ;; `Iterator :implements Iterable` that makes the chains conform hop to hop.
  (import "std/iter")

  ;; map -- produce (f x) for each element.
  (fn :extension :gen map<T> [coll <- Iterable<T> f] -> Iterator<Any>
    (for :each x :from coll :then (
      (yield (f x)))))

  ;; filter -- keep the elements satisfying (pred x).
  (fn :extension :gen filter<T> [coll <- Iterable<T> pred] -> Iterator<T>
    (for :each x :from coll :then (
      (when (pred x) :then (yield x)))))

  ;; enumerate -- pair each element with its index as `[i x]`, typed as the tuple `[Int T]` (Phase U). A
  ;; consumer `(coll |> enumerate)` destructures `[i x]` with `i` an `Int` and `x` a `T`.
  (fn :extension :gen enumerate<T> [coll <- Iterable<T>] -> Iterator<[Int T]>
    (mut i 0)
    (for :each x :from coll :then (
      (yield [i x])
      (i := (+ i 1)))))

  ;; concat -- the elements of `a`, then those of `b`.
  (fn :extension :gen concat<T> [a <- Iterable<T> b <- Iterable<T>] -> Iterator<T>
    (for :each x :from a :then ((yield x)))
    (for :each y :from b :then ((yield y))))

  ;; skip -- drop the first `n` elements, produce the rest. A counter, no early exit.
  (fn :extension :gen skip<T> [coll <- Iterable<T> n <- Int] -> Iterator<T>
    (mut i 0)
    (for :each x :from coll :then (
      (when (>= i n) :then (yield x))
      (i := (+ i 1)))))

  ;; skip-while -- drop the leading run where (pred x) holds, produce everything from the first failure
  ;; on (including it).
  (fn :extension :gen skip-while<T> [coll <- Iterable<T> pred] -> Iterator<T>
    (mut dropping true)
    (for :each x :from coll :then (
      (when (&& dropping (! (pred x))) :then (dropping := false))
      (when (! dropping) :then (yield x)))))

  ;; flat-map -- map each element to a sequence via `f`, then flatten one level.
  (fn :extension :gen flat-map<T> [coll <- Iterable<T> f] -> Iterator<Any>
    (for :each x :from coll :then (
      (for :each y :from (f x) :then (
        (yield y))))))

  ;; seq -- lift ANY iterable (an array, most importantly) into a fresh lazy cursor, so it can chain
  ;; method-style: `((seq arr).map f)` / `(arr |> seq |> (map f))`. A `:gen`, so its result is a real
  ;; generator (`[Symbol.iterator]` + `next`) that the extensions dispatch on. The receiver is untyped so
  ;; an array is accepted without ceremony -- this IS the array escape hatch out of the native `.map` shadow.
  (fn :gen seq [coll] -> Iterator<Any>
    (for :each x :from coll :then ((yield x))))

  (export map filter enumerate concat skip skip-while flat-map seq)
)

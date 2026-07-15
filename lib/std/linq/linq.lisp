;; std/linq -- the LAZY SEQUENCE operators (the C# LINQ steal). Phase L.
;;
;; This package spans TWO files (Phase M / Mb): the STRAIGHT-THROUGH operators here, and the EARLY-EXIT
;; and TERMINAL operators in `linq-early.lisp`. They are one compilation unit -- `package.yaml` names
;; `std/linq` over `sources: ["*.lisp"]` -- so `(import "std/linq")` brings in the union of both files'
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
;;   PIPED.  Collection-first means the working infix `|>` threads it: `(coll |> (map f) |> (filter p))`
;;           desugars to `filter(map(coll, f), p)` -- left-to-right LINQ, no `:extension` machinery, and
;;           it type-checks (the pipe types as its final stage's return). Collection-first also matches
;;           C#'s `this`-receiver, so -- now that `:extension` is built (D34) -- the same signatures
;;           COULD be exposed as extension methods; the pipe stays the primary surface.
;;
;; UNTYPED, on purpose (for now). Like `std/seq`'s eager ops, these ship without `-> Iterator<T>`
;; annotations. Call-site generic inference EXISTS now (Phase 5, P5b-d) -- `std/seq`'s `first`/`last`/
;; `at` are typed with it -- but the linq operators stay untyped for the moment (a follow-up); the
;; annotations can go on whenever, and the `Iterator<T> :implements Iterable<T>` already in `std/iter`
;; makes the chains check end to end. Gradually typed, they RUN correctly regardless -- what laziness needs.
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

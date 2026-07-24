;; std/seq -- EAGER, array-oriented sequence utilities, in FUNCTIONAL argument order.
;;
;; The counterpart to `std/linq`, and the boundary between them is a DELIBERATE two-convention split
;; (D33), not a duplication to collapse:
;;
;;   std/seq   EAGER, collection-LAST, array-in/array-out. `(map f coll)` runs NOW and returns an
;;             array -- the classic functional order (Clojure, Haskell), for when you just want the
;;             array. This is where `range` and the total accessors `first`/`last`/`at`/`length` live.
;;   std/linq  LAZY, collection-FIRST, pipe-surfaced. `(coll |> (map f))` builds a generator that does
;;             nothing until pulled -- for pipelines, `|>` chains, and large or infinite sources.
;;             `to-list` is how a lazy linq chain comes back to a seq-style array.
;;
;; Both export `map`/`filter`/`reduce`/`zip`: the NAMES collide, the modules do not. Imports are
;; per-file, so a file picks ONE convention -- import `std/seq` for eager array work OR `std/linq` for
;; lazy pipelines, not both in the same file.
(
  ;; `compare` gives the order: the Comparable protocol when an element implements it, else the natural
  ;; order of a primitive. So `sort`/`min`/`max` order a user type by its `compare-to` for free.
  (import "std/core/protocols")

  (fn range [start <- Int end <- Int step <- Int] -> Int[]
    (let result [])
    (for :init (mut i start) :cond (< i end) :step (i := (+ i step)) :then (
      (result.push i)
    ))
    (return result)
  )

  (fn zip [list <- Any[] other <- Any[]] -> Any[]
    (let result [])
    (let len (if (< list.length other.length) list.length other.length))
    (for :init (mut i 0) :cond (< i len) :step (i := (+ i 1)) :then (
      (result.push [list[i] other[i]])
    ))
    (return result)
  )

  ;; ================================================================================================
  ;; THE FUNCTIONAL OPERATIONS -- l-lang, not native members (D50/D53, Fg-3).
  ;;
  ;; Every one of these used to be a one-line delegation to a JavaScript array method, and D22 has
  ;; listed `std/seq` as `<- (none) [pure l-lang]` since it was written. The delegation was the
  ;; divergence: a native member is implemented once in `RuntimeProvider`/V8 and again in `runtime.c`,
  ;; and the two halves were free to disagree -- which they did, in three separate ways, none of which
  ;; any test could see because `sort`/`sort-by` have ZERO call sites in the corpus:
  ;;
  ;;   * `(sort [10 9 1 2])` answered `[1 10 2 9]` on JS. `Array.prototype.sort` with no comparator
  ;;     is SPECIFIED to stringify and compare UTF-16 code units, so it sorted numbers alphabetically
  ;;     while `docs/language-reference.md` documented it as numeric.
  ;;   * `sort-by` THREW on JS -- "Cannot convert a BigInt value to a number". It compared with
  ;;     `(- (key-fn a) (key-fn b))`, and `sort` demands a Number back from its comparator. D51 made
  ;;     an Int a BigInt, so this broke the day the numeric floor landed.
  ;;   * `sort`, `sort-by` and `flatten` TRAPPED on C: `sort` and `flat` are absent from
  ;;     `ll_dyn_method`'s vec arm, so the member simply did not exist there.
  ;;
  ;; Written in l-lang there is one implementation, so there is nothing left to diverge. Both backends
  ;; already carry `.length`, `.push`, `.slice` and the indexer -- that is what `range` and `zip` above
  ;; have always used -- so this needs no new floor entry.
  ;;
  ;; They are also PURE now, and that is a behaviour change on both backends rather than a fix to one:
  ;; `.reverse` and `.sort` mutate in place in JavaScript, and `ll_vec_reverse` returns its own
  ;; argument, so `(let b (reverse a))` used to leave `a` reversed and aliased to `b`. In the eager,
  ;; collection-last, functional half of D33's split, `(reverse xs)` answers with a reversed sequence
  ;; and leaves `xs` alone. `80-adversarial/seq_purity.lisp` pins it.
  ;; ================================================================================================

  (fn map [op coll <- Any[]] -> Any[] (
    (let out [])
    (for :init (mut i 0) :cond (< i coll.length) :step (i := (+ i 1)) :then (
      (out.push (op coll[i]))
    ))
    (return out)
  ))

  (fn filter [pred coll <- Any[]] -> Any[] (
    (let out [])
    (for :init (mut i 0) :cond (< i coll.length) :step (i := (+ i 1)) :then (
      (if (pred coll[i]) (out.push coll[i]))
    ))
    (return out)
  ))

  ;; Two arguments to `op`, exactly. JS's `reduce` hands the callback four -- accumulator, element,
  ;; INDEX and the source array -- and an l-lang lambda silently ignored the extra two. Nothing in the
  ;; corpus reads them, and a fold that quietly leaks the collection it is folding is not a contract
  ;; worth reproducing on C.
  (fn reduce [op init coll <- Any[]] -> Any (
    (mut acc init)
    (for :init (mut i 0) :cond (< i coll.length) :step (i := (+ i 1)) :then (
      (acc := (op acc coll[i]))
    ))
    (return acc)
  ))

  ;; ONE level, like JS `flat(1)`: an array element is spliced in, anything else is passed through.
  ;; That distinction needs a runtime array test, and `(x :of Array)` is it -- the D41 type guard,
  ;; which both backends already implement (`__ll_is_type`'s `case 'array'` and `ll_is_type`'s
  ;; `v.tag == LL_VEC`) and which the suite already exercises. No new floor entry was needed.
  ;; `[[1 2] 3 [4]]` is the case that discriminates: a flatten assuming every element is an array
  ;; fails on the bare `3`, and one that recursed would flatten `[[1] 2]` all the way down.
  (fn flatten [coll <- Any[]] -> Any[] (
    (let out [])
    (for :init (mut i 0) :cond (< i coll.length) :step (i := (+ i 1)) :then (
      (let x coll[i])
      (if (x :of Array)
        (for :init (mut j 0) :cond (< j x.length) :step (j := (+ j 1)) :then (
          (out.push x[j])
        ))
        (out.push x))
    ))
    (return out)
  ))

  ;; A `while`, and not by preference -- a countdown `for` MISCOMPILES on C.
  ;;
  ;; `(for :init (mut i (- coll.length 1)) :cond (>= i 0) :step (i := (- i 1)) ...)` inside a function
  ;; reached through an IMPORT emits (a) a loop variable typed `ll_value` in the condition but
  ;; subtracted as a raw `int64_t` in the step, and (b) the `:init` assignment hoisted clean out of
  ;; the function, referencing a parameter that is not in scope there. Two C compile errors, and the
  ;; module boundary is load-bearing: the same loop in the same file compiles, and a LITERAL `:init`
  ;; across the boundary compiles. So the trigger is a non-literal `:init` expression reached through
  ;; an import. Not fixed here -- it is a C backend defect, not a `std/seq` one, and it is written
  ;; down rather than merely worked around.
  (fn reverse [coll <- Any[]] -> Any[] (
    (let out [])
    (mut i <- Int (- coll.length 1))
    (while (>= i 0) (
      (out.push coll[i])
      (i := (- i 1))
    ))
    (return out)
  ))

  ;; ------------------------------------------------------------------------------------------------
  ;; The sort. A STABLE top-down mergesort, module-private, parameterised by a LESS-THAN predicate
  ;; rather than a three-way comparator.
  ;;
  ;; A predicate, deliberately. A numeric comparator is what broke `sort-by`: `(- a b)` on two Ints is
  ;; a BigInt after D51, and JS's `sort` rejects that. A Boolean `less` has no such boundary -- it is
  ;; the same shape on both backends -- and it is also exactly what stability wants: taking from the
  ;; LEFT run unless the right element is STRICTLY less is what preserves the input order of equals.
  ;;
  ;; DEBT: `slice` allocates two new arrays per level, so this is O(n log n) copies rather than the
  ;; single scratch buffer an index-range merge would use. At corpus sizes that is not worth the extra
  ;; code; revisit if anything sorts at scale.
  ;; ------------------------------------------------------------------------------------------------
  (fn seq-merge [left <- Any[] right <- Any[] less] -> Any[] (
    (let out [])
    (mut i <- Int 0)
    (mut j <- Int 0)
    (while (&& (< i left.length) (< j right.length)) (
      (if (less right[j] left[i])
        ((out.push right[j]) (j := (+ j 1)))
        ((out.push left[i]) (i := (+ i 1))))
    ))
    (while (< i left.length) ((out.push left[i]) (i := (+ i 1))))
    (while (< j right.length) ((out.push right[j]) (j := (+ j 1))))
    (return out)
  ))

  (fn seq-sort-with [coll <- Any[] less] -> Any[] (
    (if (< coll.length 2) (return (coll.slice 0)))
    ;; `Math.trunc`, and it is load-bearing. `(/ coll.length 2)` is REAL division -- D51 amendment (b)
    ;; keeps the numeric floor Real-valued precisely so a narrowing has to be written at the site that
    ;; wants it. Without it the midpoint of an odd-length run is `1.5`, and the two backends disagree
    ;; about what that means to `slice`: JS truncates the argument silently, C's `ll_unbox_int` raises
    ;; "expected an Int". So this sorted correctly on JS and trapped on C -- a divergence produced by
    ;; leaving one conversion implicit.
    (let mid (Math.trunc (/ coll.length 2)))
    (return (seq-merge (seq-sort-with (coll.slice 0 mid) less)
                       (seq-sort-with (coll.slice mid) less)
                       less))
  ))

  ;; The default order is `compare` (D63): the Comparable protocol when the element implements it,
  ;; otherwise the language's own `<` on an ordered primitive -- numbers numerically, strings
  ;; lexicographically. Primitive sorts are byte-identical to the old `(< a b)`; a Comparable user type
  ;; now sorts by its `compare-to` with no comparator passed.
  (fn sort [coll <- Any[]] -> Any[]
    (seq-sort-with coll (fn [a b] (< (compare a b) 0))))

  (fn sort-by [key-fn coll <- Any[]] -> Any[]
    (seq-sort-with coll (fn [a b] (< (compare (key-fn a) (key-fn b)) 0))))

  ;; min-by/max-by -- reduce a collection to its extreme by a KEY, ordered with `compare` (so a
  ;; Comparable key works too). `-> Any?`: nil for an empty collection (D9), else the extreme element
  ;; (ties keep the earliest). The pairwise numeric `min`/`max` live in std/math -- seq owns the
  ;; key-based collection reductions, keeping the two shelves un-collided (LL0240).
  (fn min-by [key-fn coll <- Any[]] -> Any? (
    (when (== coll.length 0) :then (return nil))
    (mut m coll[0])
    (mut mk (key-fn coll[0]))
    (for :each x :from coll :then (
      (let k (key-fn x))
      (when (< (compare k mk) 0) :then ((m := x) (mk := k)))))
    (return m)))

  (fn max-by [key-fn coll <- Any[]] -> Any? (
    (when (== coll.length 0) :then (return nil))
    (mut m coll[0])
    (mut mk (key-fn coll[0]))
    (for :each x :from coll :then (
      (let k (key-fn x))
      (when (> (compare k mk) 0) :then ((m := x) (mk := k)))))
    (return m)))

  ;; ------------------------------------------------------------------------------------------------
  ;; THE SEARCHES -- structural, and that is a deliberate semantic change (D53, Fg-4).
  ;;
  ;; `(includes [1 2] [[1 2] [3 4]])` was FALSE. The native `.includes`/`.indexOf` compare containers
  ;; by REFERENCE -- JS's SameValueZero, and C's `ll_strict_eq`, which spells
  ;; `case LL_VEC: return a.as.v == b.as.v` -- so a freshly written `[1 2]` could never be found in a
  ;; list of vectors however it was spelled. Searching a sequence for a value it contains is not a
  ;; question about object identity.
  ;;
  ;; D53 rules `equals` a structural, deep FLOOR primitive with these built on it. It did not need to
  ;; be added: `==` ALREADY lowers to `ll_deep_eq`/`__ll_deep_eq`, which is structural, deep and
  ;; recursive on both backends, already converged on int64 exactness by Fg-1, and already reachable
  ;; from source. Adding `equals` would be a second name for the same runtime function -- a second
  ;; floor entry to keep in step, which D50 says to pay for only when something is irreducible.
  ;;
  ;; The one thing a named `equals` WOULD buy is structural equality as a first-class value, because
  ;; `(f == a b)` -- passing the operator itself -- compiles on JS and fails to compile on C
  ;; ("use of undeclared identifier `u__3d_3d`"). That is a C backend gap in operator-as-value, not a
  ;; hole in the floor, and it is written down rather than worked around here.
  ;;
  ;; NOT FIXED, and not fixable to agree: the native members' CROSS-TYPE behaviour. `([1 2 3].includes
  ;; 1.0)` is `false` on JS and `true` on C -- JS's array holds BigInts where the checker typed the
  ;; elements `Int`, and SameValueZero is false across BigInt/Number, while `ll_strict_eq` promotes
  ;; both to a double. There is no answer that makes them agree, because JS's is a function of what
  ;; the CHECKER inferred rather than of the values: with the array typed `Real[]` and the needle
  ;; `Int`, JS flips to `true` and C stays `true`. So the native member's cross-type result is
  ;; unspecified host interop; `==` is numeric on both backends (D51), and these two are the
  ;; language's answer.
  ;;
  ;; `nil`, not `-1`, for a miss. That is this module's own posture -- `first`/`last`/`at` are `T?`
  ;; for exactly D9's reason, and an in-band sentinel in the same module would be it contradicting
  ;; itself. `.indexOf` keeps `-1`; it is host interop, not the language's answer.
  ;; ------------------------------------------------------------------------------------------------
  (fn index-of [x coll <- Any[]] -> Int? (
    (for :init (mut i 0) :cond (< i coll.length) :step (i := (+ i 1)) :then (
      (if (== coll[i] x) (return i))
    ))
    (return nil)
  ))

  (fn includes [x coll <- Any[]] -> Boolean
    (!= (index-of x coll) nil))

  ;; ================================================================================================
  ;; THE TOTAL ACCESSORS -- `first` / `last` / `at`, honest at last (`-> T?`).
  ;;
  ;; They are `head`-shaped: on an empty sequence there is nothing to return, and D9's argument is that
  ;; this must be `nil`, not a lie. For a long time these shipped UNTYPED (returning Unknown), because
  ;; `T[] -> T?` was inexpressible -- call-site generic inference did not exist, so declaring
  ;; `(fn first<T> [xs <- T[]] -> T?)` produced NO optional at the call site.
  ;;
  ;; It EXISTS now (Phase 5, P5b-d: `unify` / `substitute` / `instantiateSignature`). `(first [1 2 3])`
  ;; solves `T = Int` from the argument and substitutes into the return -> `Int?`, optional flag and
  ;; all. So these are declared generic and say what they mean (Phase T / Ga); `std/core` is unblocked.
  ;; ================================================================================================

  ;; Total. `nil` on an empty sequence, never `undefined` -- which is not a value this language has.
  (fn first<T> [coll <- T[]] -> T? (head coll))

  (fn last<T> [coll <- T[]] -> T?
    (if (empty coll) nil (elem coll (- coll.length 1))))

  ;; Total, like `get` and `elem`: an out-of-range index is `nil`, not a crash and not `undefined`.
  ;; The PARTIAL counterpart is the indexer `coll[i]`, which throws (D9). The pair is the whole ruling.
  (fn at<T> [coll <- T[] i <- Int] -> T? (elem coll i))

  ;; A String's length is its CHARACTER count (D52), and this had to say so explicitly.
  ;;
  ;; It was `coll.length`, which answers in the host's units: `(length "café")` was 5 on C (bytes) and
  ;; 4 on JS (UTF-16 code units), and `(length "a😀b")` was 6 and 4 where D52 says 3. C's native
  ;; `.length` counts characters as of Ff-3, but JS's cannot be moved without rewriting every member
  ;; read -- so the dispatch is HERE, in the language's own `length`, where one rule covers both.
  ;;
  ;; `(coll :of String)` is the D41 runtime type test, the same portable primitive `flatten` uses for
  ;; arrays. On a statically-typed receiver D43 folds it at compile time, so this costs nothing where
  ;; the checker already knows.
  (fn length [coll] -> Int
    (if (coll :of String) (codepoint-length coll) coll.length))

  (export range zip map filter reduce flatten reverse sort sort-by
          min-by max-by
          index-of includes first last at length)
)
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

  ;; Functional Operations
  (fn map [op coll] 
    (coll.map op))

  (fn filter [pred coll] 
    (coll.filter pred))

  (fn reduce [op init coll] 
    (coll.reduce op init))

  (fn flatten [coll] 
    (coll.flat 1))

  (fn reverse [coll] 
    (coll.reverse))

  (fn sort [coll] 
    (coll.sort))
    
  (fn sort-by [key-fn coll]
    (coll.sort (fn [a b] (- (key-fn a) (key-fn b)))))

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

  (fn length [coll] -> Int coll.length)

  (export range zip map filter reduce flatten reverse sort sort-by
          first last at length)
)
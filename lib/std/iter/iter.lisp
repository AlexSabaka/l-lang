;; std/iter -- the ITERATION PROTOCOL (D30).
;;
;; `for :each`, generators (`:gen`), and the lazy sequence operators are all DEFINED by these two
;; interfaces and LOWERED per backend (D29). Nothing here is JS-specific: on the JS backend an
;; `Iterable`'s `iterator` lowers to `[Symbol.iterator]` and `for :each` to `for...of`; on a future
;; LLVM backend the same two methods lower to vtable calls and a loop. The protocol is the contract;
;; the lowering is the backend's business.
;;
;; The shape is deliberately Rust/C#-ish and deliberately small:
;;
;;   Iterable<T> -- "you can get a fresh cursor over my Ts"
;;   Iterator<T> -- "I am that cursor; ask me for the next T until there is none"
;;
;; `next` returns `T?`, not a `{value, done}` record -- `nil` MEANS done. That folds onto D9: the same
;; optional, the same forced-unwrap, the same flow-narrowing the rest of the language already has. A
;; consumer writes `(let v (next it))` and D9's narrowing gives it a `T` after the nil-check, with no
;; new machinery.
(
  ;; The source. `iterator` produces a FRESH cursor each call, so a collection can be walked more than
  ;; once (`for :each` over the same array twice must start over both times).
  (definterface Iterable<T>
    (fn iterator [] -> Iterator<T>))

  ;; The cursor. One method, and it is the whole protocol: hand back the next element, or `nil` when
  ;; the sequence is exhausted. Calling `next` again after `nil` keeps returning `nil`.
  ;;
  ;; An Iterator IS an Iterable (Phase L / La): a cursor can stand wherever a source is wanted, and it
  ;; iterates AS ITSELF -- true in JS, Rust (`Iterator: IntoIterator`) and Python. This is what lets the
  ;; lazy operators chain: `map` returns an `Iterator<U>`, `filter` takes an `Iterable<T>`, and the pipe
  ;; `(coll |> (map f) |> (filter p))` type-checks because the former satisfies the latter. A
  ;; hand-written iterator satisfies it by returning `this` from `iterator()`, which every one already
  ;; does (the `Countdown` fixture, `std/iter`'s own conformance test).
  (definterface Iterator<T> :implements Iterable<T>
    (fn next [] -> T?))

  ;; The DETERMINISTIC edge, and deliberately a SEPARATE interface rather than a member on
  ;; `Iterator<T>` (D58).
  ;;
  ;; A lazy source is routinely abandoned rather than exhausted -- `take`, `take-while`, `first` and
  ;; `any` all stop early, which is what they are FOR -- so "the sequence ended" and "the consumer
  ;; walked away" are different events, and only the second needs a cleanup hook. Prior art agrees on
  ;; the shape: C#'s `IEnumerator<T> : IDisposable` with `foreach` disposing in a finally is the clean
  ;; one; JS's optional `return()` is the same idea as an optional member; Python's GC-coupled
  ;; `close()` is the version PEP 533 exists to apologise for; Java's hookless `Iterator` is the
  ;; cautionary tale.
  ;;
  ;; Separate, though, because bolting `dispose` onto `Iterator<T>` would break every hand-written
  ;; iterator in the corpus at once -- `:implements Iterator` is a PROMISE the checker enforces
  ;; (LL0235), so a new member is a new obligation for code that has no resource to release. A
  ;; consumer type-tests instead: dispose what is `Disposable`, leave everything else alone.
  ;;
  ;; GC is NOT the mechanism (D59: memory-only, no finalizers). That is not a limitation to work
  ;; around -- JS never runs an abandoned generator's `finally` either, so scope-bound disposal is
  ;; the behaviour BOTH backends can actually agree on.
  (definterface Disposable
    (fn dispose [] -> Void))

  ;; --------------------------------------------------------------------------------------------
  ;; Range -- the `..` operator's value type (D46/B-0). `(lo .. hi)` DESUGARS (in the grammar) to
  ;; `(Range lo hi nil true)`: an INCLUSIVE integer range, step unset. It is a lazy Iterable<Int> --
  ;; nothing is materialised; `for :each` and the std/iter operators pull it one Int at a time, and
  ;; `(collect r)` if you want the array.
  ;;
  ;;   (0 .. 5)              0 1 2 3 4 5     inclusive, +1
  ;;   (10 .. 1)             10 9 ... 1      lo>hi infers -1 (descending is first-class)
  ;;   ((0 .. 10).by 2)      0 2 4 6 8 10    step magnitude; sign still follows direction
  ;;   ((0 .. 5).exclusive)  0 1 2 3 4       drops the upper bound
  ;;
  ;; INT ONLY in v1. Real/Char/generic Range<T> are deferred: a generic `T` cannot name its unit
  ;; step (Int's is the literal 1), so they need a numeric/steppable protocol -- its own round.
  ;; --------------------------------------------------------------------------------------------

  ;; The cursor: a mutable position and a RESOLVED signed step (never nil). An Iterator IS an
  ;; Iterable, so `iterator` returns `this` (single pull, like the hand-written iterator fixture).
  (defstruct RangeCursor :implements Iterator<Int>
    (mut :ctor current <- Int)
    (mut :ctor stop <- Int)
    (mut :ctor step <- Int)
    (mut :ctor inclusive <- Boolean)
    (fn iterator [] -> Iterator<Int> (return this))
    (fn next [] -> Int? (
      (let ascending (> this.step 0))
      (let done (if ascending
                    (if this.inclusive (> this.current this.stop) (>= this.current this.stop))
                    (if this.inclusive (< this.current this.stop) (<= this.current this.stop))))
      (if done (return nil))
      (let cur this.current)
      (this.current := (+ this.current this.step))
      (return cur)))
  )

  ;; The source: re-iterable (a FRESH cursor per `iterator` call). `step` is nil until `.by` sets a
  ;; magnitude; the sign is inferred from lo vs hi at iterate time.
  (defstruct Range :implements Iterable<Int>
    (mut :ctor lo <- Int)
    (mut :ctor hi <- Int)
    (mut :ctor step <- Int?)
    (mut :ctor inclusive <- Boolean)
    (fn iterator [] -> Iterator<Int> (
      (let ascending (<= this.lo this.hi))
      (let st this.step)
      (let magnitude (if (!= st nil) (if (< st 0) (- 0 st) st) 1))
      (let signed (if ascending magnitude (- 0 magnitude)))
      (return (RangeCursor this.lo this.hi signed this.inclusive))))
    ;; `.by n` -- set the step MAGNITUDE (sign still follows direction). Returns a new Range.
    ;; A zero step would never advance the cursor (an infinite walk), so it is rejected here.
    (fn by [n <- Int] -> Range (
      (if (== n 0) (throw (Error "Range.by: step cannot be 0")))
      (return (Range this.lo this.hi n this.inclusive))))
    ;; `.exclusive` -- drop the upper bound. Returns a new Range.
    (fn exclusive [] -> Range (return (Range this.lo this.hi this.step false)))
  )

  (export Iterable Iterator Disposable Range)
)

;; std/iter -- `Range`, and the home of the iteration protocol's CONSUMERS.
;;
;; The protocol ITSELF -- `Iterable<T>`, `Iterator<T>`, `Disposable` -- moved to `std/protocols`
;; (D107). It is a cross-cutting contract: `for :each`, `:gen` and every lazy operator are defined by
;; it and lowered per backend (D29), and types in unrelated packages implement it, so it does not
;; belong to the module that happened to consume it first. `Disposable` never belonged here at all --
;; its own comment argues it is NOT part of the iteration protocol.
;;
;; Re-exporting them from here is not an option and not an oversight: a module cannot re-export a
;; symbol it does not declare (DECISIONS.md, D-note at :2436). A file that names `Iterable`,
;; `Iterator` or `Disposable` imports `std/protocols` directly, and since B1 an unresolved
;; `:implements` is LL0249 rather than silence -- so a missed import is now a diagnostic instead of
;; conformance quietly switching off.
(
  (import "std/protocols")

  ;; --------------------------------------------------------------------------------------------
  ;; Range -- the `..` operator's value type (D46/B-0). `(lo..hi)` DESUGARS (in the grammar) to
  ;; `(Range lo hi nil true)`: an INCLUSIVE integer range, step unset. It is a lazy Iterable<Int> --
  ;; nothing is materialised; `for :each` and the std/iter operators pull it one Int at a time, and
  ;; `(collect r)` if you want the array.
  ;;
  ;;   (0..5)                0 1 2 3 4 5     inclusive, +1
  ;;   (10..1)               10 9 ... 1      lo>hi infers -1 (descending is first-class)
  ;;   ((0..10).by 2)        0 2 4 6 8 10    step magnitude; sign still follows direction
  ;;   ((0..5).exclusive)    0 1 2 3 4       drops the upper bound
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

  ;; `Range` only. The three protocol names are declared by `std/protocols` now, and a module cannot
  ;; re-export a symbol it does not declare -- listing them here would be a silent no-op at best.
  (export Range)
)

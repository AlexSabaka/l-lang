;; ADVERSARIAL: `..` binds by ADJACENCY (D88/N4).
;;
;;     1..2    -- ONE element: a Range
;;     1 .. 2  -- THREE elements, the middle one a standalone `..` (the span/wildcard)
;;
;; NOT an operator whose meaning changes with whitespace. l-lang separates list elements BY
;; whitespace, so `1..2` versus `1 .. 2` is the same boundary question as `12` versus `1 2`: one
;; element or three. The rule already governs every other element in the language; this applies it to
;; a token that happens to be punctuation.
;;
;; WHAT IT BUYS: `array[1..2]` is one range index and `array[1 .. 2]` is an index, a span, an index --
;; distinguishable without inventing a second token or making commas significant. Spans need
;; multidimensional views, which do not exist, so a standalone `..` is `LL0034` rather than silence.
;;
;; THE HALF THAT WAS NEVER WIRED. `..` desugared to `(Range lo hi nil true)` from the beginning and
;; `Range` was unreachable -- `(0 .. 3)` was `LL0210 'Range' is not defined` unless you imported
;; `std/iter` yourself. It is demand-injected now, on the same ruling as a numeric literal: the
;; operator IS the request. This file imports nothing.
;;
;; MIGRATION COST, recorded because it was real: 16 corpus files used the spaced form, mostly
;; `:satisfies (0 .. 255)` refinements. All were rewritten tight. Doing this BEFORE spans exist is the
;; cheap moment -- afterwards it would break working programs rather than a corpus.
(
    ;; -- a tight range is a Range, with no import ---------------------------------------------------

    (for :each i :from (0..3) :then (console.log "up:  " i))

    ;; Descending needs no special spelling -- Range fills in the -1 step from the direction.
    (for :each i :from (3..1) :then (console.log "down:" i))

    ;; The methods are ordinary methods on the constructed value, so they compose with the tight form.
    (for :each i :from ((0..10).by 5) :then (console.log "by 5:" i))
    (for :each i :from ((0..3).exclusive) :then (console.log "excl:" i))

    ;; -- a range is a VALUE, not just a loop header ------------------------------------------------
    ;;
    ;; Bound to a name, then iterated -- which is the property that makes it an ordinary construction
    ;; rather than loop syntax. (`.start`/`.end` are not reachable on C: `ELL0106 method:Range.start`.
    ;; Measured, and orthogonal to adjacency.)

    (let r (1..3))
    (for :each i :from r :then (console.log "bound:" i))

    ;; -- adjacency is about ELEMENT COUNT ----------------------------------------------------------
    ;;
    ;; `(1..3)` is ONE element that happens to be a Range, so binding it needs no extra parens. The
    ;; spaced form is three elements and the middle one is reported -- the count IS the distinction.

    (let a (1..2))
    (let b (3..4))
    (for :each i :from a :then (console.log "a:   " i))
    (for :each i :from b :then (console.log "b:   " i))

    ;; TWO LIMITS, measured rather than assumed, and BOTH pre-existing -- the spaced form had them
    ;; too, so neither is a cost of adjacency:
    ;;
    ;;   * `[1..2 3..4]` does not parse. The `..` branch lives in the LIST rule and the vector/matrix
    ;;     rules consume plain expressions, so a range inside a vector literal has never worked.
    ;;   * `(let a 1..2)` is not a range either. The branch fires only when the `..` and its two
    ;;     operands are the WHOLE list, so a range needs its own parens: `(let a (1..2))`.
    ;;
    ;; Both are the same shape -- `..` is a list form, not an expression-level operator -- and both are
    ;; their own piece of parser work.
)

;; THE FORMS, INSIDE A GENERATOR FRAME -- the axis that found three defects in a row.
;;
;; `match` here is the one that was BROKEN, and it emitted C that would not compile:
;;
;;     ll_deep_eq(ll_box_int((__f)->fields[2]), ll_box_int(INT64_C(1)))
;;
;; an `ll_value` passed where `int64_t` is expected. Every sibling read in the same function was
;; correctly `ll_unbox_int((__f)->fields[n])`; exactly one was not. `if (== i 1)` on the same binding
;; was fine, so the form -- not the promotion -- was the discriminator.
;;
;; THE CAUSE WAS A COMMENT ASSERTING A PREMISE THAT HAD STOPPED BEING TRUE. `InsertCoercions` returned
;; `c-box`/`c-unbox`/`c-cast` nodes unvisited, "only this pass mints them" -- but `ResolveHirToCir`
;; mints `c-box` in four places, and `promoteFrame` (also P1) rewrites a `c-temp` into a
;; `c-field-get` AFTER those boxes exist. So a P1 box could wrap an already-boxed frame slot with no
;; unbox between them, and the pass that exists to insert exactly that unbox declined to look.
;;
;; Recursing changed the emitted C for **0 of 45** sampled corpus files, byte-for-byte: nothing in the
;; corpus reached the broken path, which is why 371 files and a green gate never saw it.
;;
;; The rest of the rows are the sweep that found it. They were correct already and are pinned here so
;; they stay that way -- a generator frame re-enters its body by `goto`, and every one of these forms
;; is a control structure the dispatch has to jump into the middle of.
(
    (import "std/protocols")

    ;; 1. MATCH with a suspend in its arms -- the broken one.
    (fn :gen matched [] -> Iterator<Int> (
        (mut i 0)
        (while (< i 3) (
            (i := (+ i 1))
            (match i { 1 => (yield 10)  _ => (yield 1) })))))

    ;; 2. COND, whose clauses are a different lowering from match's arms.
    (fn :gen conded [] -> Iterator<Int> (
        (mut i 0)
        (while (< i 2) (
            (i := (+ i 1))
            (cond ((> i 1) (yield 5)) (:else (yield 2)))))))

    ;; 3. WHEN -- a block body, and the suspend is the whole of it.
    (fn :gen whened [] -> Iterator<Int> (
        (mut i 0)
        (while (< i 2) (
            (i := (+ i 1))
            (when (> i 0) (yield i))))))

    ;; 4. DESTRUCTURING into a frame: both names are promoted slots.
    (fn :gen destructured [] -> Iterator<Int> (
        (let [a b] [3 4])
        (yield a)
        (yield b)))

    ;; 5. A CONTAINER in a frame -- the slot holds the pointer, and it must survive re-entry.
    (fn :gen containered [] -> Iterator<Int> (
        (let v [1 2 3])
        (yield v.length)
        (yield (+ v[0] v[2]))))

    ;; 6. An EARLY RETURN ends the generator: the tail after it is unreachable, not merely unyielded.
    (fn :gen returned [] -> Iterator<Int> (
        (yield 1)
        (if true (return))
        (yield 99)))

    ;; 7. A generator DRIVING ANOTHER generator -- two frames live at once, each with its own state.
    (fn :gen inner [] -> Iterator<Int> ((yield 1) (yield 2)))
    (fn :gen outer [] -> Iterator<Int> (
        (for :each y :from (inner) :then (yield (* y 10)))))

    (fn dump [tag <- String  it <- Any] -> Void (for :each x :from it :then (console.log tag x)))
    (dump "matched:" (matched))
    (dump "conded:" (conded))
    (dump "whened:" (whened))
    (dump "destructured:" (destructured))
    (dump "containered:" (containered))
    (dump "returned:" (returned))
    (dump "outer:" (outer))
)

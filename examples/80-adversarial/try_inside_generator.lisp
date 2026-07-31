;; A `try` INSIDE A GENERATOR, which the C backend refused for a reason broader than the ruling.
;;
;; D58 rule 3 forbids `yield` inside a protected region (LL0239), language-wide, because a generator
;; suspends by RETURNING and C11 7.13.2.1 makes landing in a destroyed activation undefined. The C
;; backend implemented something stricter: `promoteFrame` refused ANY protected region inside a
;; generator body, so a `try` that contains no suspend at all -- one that completes entirely between
;; two labels -- was `ELL0106 ... no lowering exists`. JS ran the same program correctly. A ruling and
;; an implementation disagreeing, which is the shape D114 had.
;;
;; LL0239 IS WHAT MAKES THIS SOUND, and the fix rests on it. The emitter's `ll_frame` is a STACK local
;; whose address is published to the global `ll_handler_top`; a suspend inside the region would leave
;; that global pointing into a dead activation. D58 forbids exactly that suspend, so the region always
;; completes and pops within the one step call that entered it. `volatiles.ts:116` and `runtime.c:2495`
;; already reasoned from this same guarantee -- `promoteFrame` was the sibling that did not.
;;
;; Nothing needed to change in the slot layout: `subBlocks` has always listed a try's blocks, so
;; `collectDecls` was already promoting the declarations inside one. Only the rewrite arm was missing.
;;
;; THE `-O2` RUN IS THE POINT OF THE FIRST GENERATOR. A frame slot written in a CATCH and read after a
;; LATER suspension lives in `ll_obj.fields[]`, not in the step function's activation -- so promotion
;; makes it immune to the C11 clobber class by construction, and `volatile` is irrelevant to it. That
;; is an argument, and only `npm run test:c:o2` can falsify it.
(
    (import "std/protocols")

    (fn risky [n <- Int] -> Int ((if (< n 0) (throw (new ValueError "boom"))) (return n)))

    ;; 1. A frame slot written INSIDE A CATCH, read after a later suspension. If the catch's write
    ;;    were lost across the suspend, this would print 10 and 11 instead of 15 and 16.
    (fn :gen across [] -> Iterator<Int> (
        (mut acc 0)
        (yield 1)
        (try ((acc := 10) (risky -1)) catch e ((acc := (+ acc 5))))
        (yield acc)
        (yield (+ acc 1))))

    ;; 2. INTERLEAVED: three landings and three suspensions alternating, against one slot. The frame
    ;;    is re-entered after every landing, so a stale `ll_handler_top` would surface here first.
    (fn :gen interleaved [] -> Iterator<Int> (
        (mut c 0)
        (mut i 0)
        (while (< i 3) (
            (i := (+ i 1))
            (try ((c := (+ c 1)) (risky -1)) catch e ((c := (+ c 10))))
            (yield c)))))

    ;; 3. NESTED regions and a `finally`, inside a frame: 1, catch +2, outer throw, catch +4, finally +8.
    (fn :gen nested [] -> Iterator<Int> (
        (mut d 0)
        (try ((try ((d := 1) (risky -1)) catch e ((d := (+ d 2))))
              (risky -1))
          catch e ((d := (+ d 4)))
          finally ((d := (+ d 8))))
        (yield d)))

    ;; 4. D110's OPTIONAL try inside a frame. Worth its own row because the desugar SYNTHESISES a
    ;;    catch arm for a bare `(try e)`, and that arm is now promoted like any other.
    ;;
    ;;    THE VALUE IS TESTED FOR NIL BUT NEVER USED AS AN `Int`, deliberately: `(yield v)` here is
    ;;    `ELL0225 produces Int, but yields Int | Nil`, because D9's narrowing does NOT reach a
    ;;    `T | Nil`. The same `(!= x nil)` guard narrows a declared `Int?` and does not narrow the
    ;;    union D110 produces -- measured on both backends, in a yield, a call argument and a return.
    ;;    That is the parked `T?` vs `T | Nil` question, recorded in docs/roadmap.md; pinning it here
    ;;    would pin a hole rather than a behaviour.
    (fn :gen opt [] -> Iterator<Int> (
        (mut acc 0)
        (let v (try (risky 10)))
        (if (!= v nil) (acc := 10))
        (yield acc)))

    (fn dump [tag <- String  it <- Any] -> Void (for :each x :from it :then (console.log tag x)))
    (dump "across:" (across))
    (dump "interleaved:" (interleaved))
    (dump "nested+finally:" (nested))
    (dump "optional:" (opt))

    ;; 5. THE OTHER DIRECTION: the throw is inside the generator and the `try` is in the CONSUMER, so
    ;;    the longjmp crosses the step function rather than staying inside it. `seen` is 1 because the
    ;;    first element arrives before the throw and the second is never reached.
    (mut seen 0)
    (try (for :each x :from (thrower) :then (seen := (+ seen x)))
      catch e ((console.log "crossed the boundary, seen:" seen)))
    (fn :gen thrower [] -> Iterator<Int> ((yield 1) (risky -1) (yield 2)))
)

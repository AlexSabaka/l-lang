;; CONFORMANCE guard: a `while` whose CONDITION contains a call.
;;
;; `(while (< i (pack.count)) ...)` is an entirely ordinary loop, and it did not compile. The HIR's
;; `lowerWhile` refused any condition that needed hoisted statements -- and a call needs one -- with
;; the comment "a statement-bearing condition (rare) falls back to the legacy emitter". It is not
;; rare, and the fallback does not work: the legacy JS visitor has no `visitIf`, so such a loop with
;; ANY `if` in its body died with `ELL0100 visitIf is not implemented in the JS backend`.
;;
;; Found by a real program -- a dungeon-crawler sample outside this repo -- not by a test. Three
;; hypotheses were wrong before the trigger was isolated (generics, nesting depth, optionals); what
;; actually matters is only: a CALL in the condition, and an `if` in the body.
;;
;; THE FIX IS ROTATION, not a legacy `visitIf`:
;;
;;     <prelude>                      while (t) {
;;     t = <test>            ==>          <body>
;;                                        <prelude'>     ;; re-evaluated
;;                                        t = <test'>
;;                                    }
;;
;; The condition is lowered TWICE so the second copy gets its own temps. Rotation rather than
;; `while (true) { ...; if (!t) break; }` because THE HIR HAS NO `break` NODE -- this needs only
;; decl-temp/assign-temp, which it has.
;;
;; -----------------------------------------------------------------------------------------------
;; AND IT UNCOVERED A LATENT MISCOMPILE, which is the more interesting half.
;;
;; The lazy-logical lowering (`&&`/`||` whose right operand needs a prelude) emitted
;; `const t = <first>` and then ASSIGNED to `t` in each arm -- `Assignment to constant variable`.
;; That path was unreachable only by accident: such a logical appears most often in a while
;; condition, and a statement-bearing while condition bailed to legacy before ever reaching it.
;; Rotating instead of bailing made the path live, and `std/string`'s `trim` broke immediately.
;;
;; So the guard covers both: a call in the condition, and a `&&` whose right operand needs a prelude.
;; The second is `trim`'s exact shape.
(
    (fn size [] -> Int (return 3))
    (fn is-space [c <- Int] -> Boolean (return (== c 32)))

    ;; 1. A CALL in the condition, with an `if` in the body. The original failure.
    (mut idx -1)
    (mut i 0)
    (while (< i (size)) (
        (if (== idx -1) (if (> i 1) (idx := i)))
        (i := (+ i 1))
    ))
    (console.log "found at:  " idx)

    ;; 2. The condition must RE-EVALUATE. `limit` shrinks under the loop, and only a genuinely
    ;;    re-tested condition notices -- a hoisted-once test would run to the original bound.
    (mut limit 3)
    (mut calls 0)
    (fn bound [] -> Int (
        (calls := (+ calls 1))
        (return limit)
    ))
    (mut j 0)
    (mut seen [])
    (while (< j (bound)) (
        (seen.push j)
        (if (== j 1) (limit := 2))
        (j := (+ j 1))
    ))
    (console.log "iterations:" seen)
    (console.log "cond calls:" calls)

    ;; 3. Zero iterations: the condition is evaluated ONCE and the body never runs.
    (mut ran false)
    (while (> 0 (size)) (ran := true))
    (console.log "never ran: " (== ran false))

    ;; 4. A `&&` whose right operand needs a prelude -- `std/string`'s `trim`, which is what the
    ;;    const-assignment miscompile actually broke.
    (let cps [32 32 65 66])
    (mut a 0)
    (let b cps.length)
    (while (&& (< a b) (is-space cps[a])) (a := (+ a 1)))
    (console.log "skipped:   " a)
)

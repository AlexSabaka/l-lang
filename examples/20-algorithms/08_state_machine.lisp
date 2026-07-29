;; A turnstile, as a state machine folded over an event list
;;
;; The classic coin-operated turnstile: it starts LOCKED, a COIN unlocks it,
;; and a PUSH lets exactly one person through and locks it again.
;;
;; This example combines:
;; - `defenum` twice: once for the states, once for the events
;; - `match` on a vector pattern `[s e]` -- the (state, event) pair is matched
;;   against a literal transition table, which is what a transition table
;;   should look like
;; - `cond` to pick the human-readable effect of each transition
;; - `std/seq`'s `reduce` to fold the machine over the whole event list,
;;   carrying the context forward instead of mutating a global
;; - a map for the machine context (state + counters), rebuilt on every step

(
    (import "std/seq")

    (defenum State
        :LOCKED
        :UNLOCKED)

    (defenum Event
        :COIN
        :PUSH)

    (fn state-name [s] -> String (
        (match s {
            State:LOCKED   => "LOCKED"
            State:UNLOCKED => "UNLOCKED"
            _              => "?"
        })
    ))

    (fn event-name [e] -> String (
        (match e {
            Event:COIN => "COIN"
            Event:PUSH => "PUSH"
            _          => "?"
        })
    ))

    ;; 1. The transition table. `[s e]` builds a two-element vector and the
    ;;    match arms destructure it against constant enum pairs, so the table
    ;;    reads exactly like the one you would draw on a whiteboard:
    ;;      LOCKED   + COIN -> UNLOCKED
    ;;      LOCKED   + PUSH -> LOCKED
    ;;      UNLOCKED + COIN -> UNLOCKED
    ;;      UNLOCKED + PUSH -> LOCKED
    (fn next-state [s e] (
        (match [s e] {
            [State:LOCKED   Event:COIN] => State:UNLOCKED
            [State:LOCKED   Event:PUSH] => State:LOCKED
            [State:UNLOCKED Event:COIN] => State:UNLOCKED
            [State:UNLOCKED Event:PUSH] => State:LOCKED
            _                           => s
        })
    ))

    ;; 2. What the transition looked like from the outside. The interesting
    ;;    cases are the two where the state actually changed; the remaining
    ;;    two are told apart by the state we were already in.
    (fn effect [s e ns] -> String
        (cond
            ((&& (== s State:LOCKED)   (== ns State:UNLOCKED)) (return "unlocks"))
            ((&& (== s State:UNLOCKED) (== ns State:LOCKED))   (return "lets you through, then locks"))
            ((== s State:LOCKED)                               (return "blocks you"))
            (true                                              (return "already open, coin refunded"))
        )
    )

    ;; 3. One step of the machine: log the transition and return the NEW
    ;;    context. Nothing is mutated -- `reduce` threads the context through.
    ;;    The counters use `match` as an expression to score each event.
    (fn advance [ctx e] (
        (let ns (next-state ctx.state e))
        (let n (+ ctx.tick 1))
        (console.log f"{(n)}. {(state-name ctx.state)} --{(event-name e)}--> {(state-name ns)} : {(effect ctx.state e ns)}")
        (return {
            :state ns
            :tick n
            :coins (+ ctx.coins (match e { Event:COIN => 1 _ => 0 }))
            :entries (+ ctx.entries (match [ctx.state e] { [State:UNLOCKED Event:PUSH] => 1 _ => 0 }))
        })
    ))

    ;; 4. Drive the machine with a fixed script of events.
    (let events [Event:PUSH Event:COIN Event:COIN Event:PUSH Event:PUSH Event:COIN Event:PUSH])

    (console.log "--- transitions ---")
    (let final (reduce advance { :state State:LOCKED :tick 0 :coins 0 :entries 0 } events))

    (console.log "--- summary ---")
    (console.log f"final state: {(state-name final.state)}")
    (console.log f"coins taken: {(final.coins)}")
    (console.log f"entries: {(final.entries)}")
)

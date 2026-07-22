;; CONFORMANCE guard: the TOTAL accessors are total, and keys are not coerced (D9 / D53, F.3+F.5).
;;
;; `head`/`tail`/`get`/`elem` are the total half of D9's pair: the indexer `c[k]` is PARTIAL and
;; throws, and these answer `nil` instead. That is the whole contract, and two of them were not
;; keeping it.
;;
;; ------------------------------------------------------------------------------------------------
;; 1. `head`/`tail` ON A NON-VECTOR KILLED THE C PROCESS.
;;
;; `ll_head`/`ll_tail` called `ll_unbox_vec` unguarded, while every sibling in the same floor cluster
;; -- `ll_get`, `ll_elem`, `ll_empty` -- is a switch with a nil/default arm. So:
;;
;;     (head "abc")   JS: nil    C: TypeError: expected a Vector, exit 70, nothing printed
;;
;; and it is reachable from ordinary nil-propagating code, with no cast and no `Any` annotation:
;;
;;     (let m {:a [1 2]})
;;     (head (get m "b"))      ;; `get` is total and answers nil on a miss (D9) -- feeding that to
;;                             ;; `head` is exactly what an expression language invites
;;
;; A wrong answer is recoverable; a process death mid-`console.log` is not. Both now answer nil / [].
;;
;; ------------------------------------------------------------------------------------------------
;; 2. KEYS ARE NOT COERCED, and the two backends had opposite habits.
;;
;;     (get v "1")    on a vector    JS: 20 (the host stringified the index)   C: nil
;;
;; A key is an `Int` or a `String` -- those are the two key SPACES the language has -- and which one
;; a container accepts is a property of the container: a vector and a String are indexed by position,
;; a map by name. A key of the wrong kind is not an error, it is simply absent, so a TOTAL accessor
;; answers nil. Coercing instead means `(get v "1")` silently succeeds and the same program written
;; against a map silently means something else.
;;
;; A `Real` key is now rejected by the CHECKER rather than at runtime -- `get`'s key parameter is
;; typed `Int | String` on the floor, and after F.1 the checker actually reads floor signatures for
;; simple names. `(get xs (Math.floor i))` is a diagnostic naming the fix, where before it answered
;; 20 on JS and nil on C. D51 amendment (b) types every `Math.*` but `trunc` as `-> Real` precisely so
;; that a narrowing has to be written down; this is that rule reaching the accessors.
;;
;; An INT key on a MAP still works and still stringifies -- that is settled by D53 (Fg-2), which rules
;; the key space to be String and both runtimes to stringify on the way in, so `(m[1] := v)` and
;; `(get m 1)` agree. "No coercion" is about Real-to-Int and about the wrong key KIND, not about
;; unmaking that ruling.
(
    (let v [10 20 30])
    (let m {:a 1})

    ;; -- 1. total accessors on the wrong shape -------------------------------------------------------
    (console.log "head str: " (head "abc"))
    (console.log "head nil: " (head nil))
    (console.log "head map: " (head m))
    (console.log "tail str: " (tail "abc"))
    (console.log "tail nil: " (tail nil))
    (console.log "tail map: " (tail m))

    ;; The reachable composition: `get` misses, answers nil, and nil flows into `head`.
    (let holder {:a [1 2]})
    (console.log "hit:      " (head (get holder "a")))
    (console.log "miss:     " (head (get holder "b")))

    ;; -- 2. key kinds --------------------------------------------------------------------------------
    (console.log "vec int:  " (get v 1))
    (console.log "vec str:  " (get v "1"))
    (console.log "str int:  " (get "abc" 1))
    (console.log "str str:  " (get "abc" "1"))
    (console.log "map name: " (get m "a"))
    (console.log "elem int: " (elem v 1))
    (console.log "elem str: " (elem v "1"))

    ;; Out of range stays nil -- that is the total contract, unchanged.
    (console.log "vec oob:  " (get v 99))
    (console.log "map miss: " (get m "zz"))

    ;; An INT key on a MAP still stringifies (D53). Not undone by the no-coercion ruling.
    (let n {})
    (n[1] := "one")
    (console.log "map int:  " (get n 1))
    (console.log "map as-s: " (get n "1"))
)

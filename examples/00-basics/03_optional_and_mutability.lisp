;; Optional values, and mutability
;;
;; Two ideas that are easy to confuse, and are not the same one:
;;
;;   `String?`   -- the VALUE may be absent.    (D9)
;;   `mut`       -- the BINDING may be rebound. (D10)
;;
;; A `let` optional is a value that might be nil and can never be reassigned. A `mut` non-optional
;; is a value that is definitely there and can be swapped for another. The two axes are independent.
;;
;; This example demonstrates:
;; - `T?` vs `T`, across `let` and `mut`
;; - the forced unwrap, and the nil-checks that discharge it
;; - functions that may answer with nothing
;; - rebinding a name vs mutating what the name points at

(
    ;; ------------------------------------------------------------------------------------------
    ;; 1. The two axes are independent.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- optional vs mutable ---")

    (let fixed-known   <- String  "always here, never changes")
    (let fixed-maybe   <- String? nil)
    (mut movable-known <- String  "always here, may be replaced")
    (mut movable-maybe <- String? nil)

    (console.log "let String :" fixed-known)
    (console.log "let String?:" fixed-maybe)
    (console.log "mut String :" movable-known)
    (console.log "mut String?:" movable-maybe)

    ;; Only the `mut` bindings can be rebound.
    (movable-known := "replaced")
    (movable-maybe := "no longer nil")
    (console.log "rebound to :" movable-known "/" movable-maybe)

    ;; ------------------------------------------------------------------------------------------
    ;; 2. `T` refuses nil -- and that is a PROMISE about `T`, not a restriction on nil.
    ;;
    ;;    (let bad <- Int nil)     ;; LL0200: cannot assign Nil to Int
    ;;
    ;; Because an `Int` can never be nil, nothing that takes an `Int` has to check for it.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- a promise, not a restriction ---")

    (fn double [n <- Int] -> Int (return (* n 2)))   ;; no nil check here. There cannot be one.
    (console.log "double 21:" (double 21))

    ;; ------------------------------------------------------------------------------------------
    ;; 3. An optional must be unwrapped before it is used.
    ;;
    ;;    (console.log fixed-maybe.length)   ;; LL0205: 'fixed-maybe' is possibly nil (String?)
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- the forced unwrap ---")

    (mut label <- String? "hello")

    (if (!= label nil)
        (console.log "label has" label.length "characters")
        (console.log "label is nil"))

    (label := nil)

    (if (!= label nil)
        (console.log "label has" label.length "characters")
        (console.log "label is nil"))

    ;; ------------------------------------------------------------------------------------------
    ;; 4. A lookup that may not find anything says so in its return type.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- a lookup that may fail ---")

    (fn find-name [id <- String] -> String? (
        (let names {"1" "Alice" "2" "Bob"})
        (return (get names id))
    ))

    ;; The guard-and-return. Below the guard, `found` is a plain String -- the compiler followed the
    ;; reasoning and stops asking.
    (fn greet [id <- String] -> String (
        (let found (find-name id))
        (if (== found nil)
            (return "no such user"))
        (return (+ "Hello, " found))
    ))

    (console.log (greet "1"))
    (console.log (greet "2"))
    (console.log (greet "999"))

    ;; ------------------------------------------------------------------------------------------
    ;; 5. `mut` governs the BINDING. It does not deep-freeze what the binding points at.
    ;;
    ;; A `let` array cannot be REPLACED -- but it can still be pushed to, because that mutates the
    ;; array, not the binding. Two names for one array see each other's changes.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- rebinding vs mutating ---")

    (mut totals [])
    (for :each n :from [10 20 30 40] :then (totals.push n))
    (console.log "collected: " totals)

    (let first-list [1 2 3])
    (let alias first-list)          ;; the SAME array, under a second name
    (first-list.push 999)
    (console.log "first-list:" first-list)
    (console.log "alias:     " alias)

    ;; ------------------------------------------------------------------------------------------
    ;; 6. A mutable optional: the classic cache.
    ;; ------------------------------------------------------------------------------------------
    (console.log "--- a mutable optional ---")

    (mut cache <- String? nil)

    (fn describe-cache [c <- String?] -> String (
        (if (== c nil)
            (return "empty"))
        (return (+ "holding: " c))
    ))

    (console.log (describe-cache cache))
    (cache := "some-value")
    (console.log (describe-cache cache))
    (cache := nil)
    (console.log (describe-cache cache))
)

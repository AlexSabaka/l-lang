;; A destructuring declaration, and the three ways it can silently differ between backends.
;;
;; JavaScript has `let [a, b] = pt` natively; C does not, and until this lowering existed a
;; destructuring `let` was `ELL0106` — one of the three features that only worked on the deprecated
;; backend. The lowering is a temporary plus N ordinary bindings, which is what the native form means
;; anyway. Each line below pins something that would otherwise diverge quietly.
(
    ;; 1. THE INITIALIZER IS EVALUATED ONCE. N separate reads of the initializer EXPRESSION would call
    ;;    `pair` N times; the temporary is what makes that impossible. A side-effecting initializer is
    ;;    the only way to observe the difference, which is why the counter is here.
    (mut calls 0)
    (fn pair [] -> Int[] ((calls := (+ calls 1)) (return [7 8])))

    (let [a b] (pair))
    (console.log "evaluated once:" calls "->" a b)

    ;; 2. A SHORT VECTOR GIVES NIL, IT DOES NOT TRAP. This is the subtlety the `for :each` destructure
    ;;    already paid for: `ll_index_vec` traps out of range, while JS's `let [a,b,c] = [1,2]` leaves
    ;;    `c` undefined, which D9 makes nil. An unguarded index would turn a short vector from a silent
    ;;    nil on one backend into a PROCESS EXIT on the other — in a construct whose whole point is
    ;;    that it reads like a pattern match.
    (let [x y z] [1 2])
    (console.log "short vector:" x y z)

    ;; 3. MAP PATTERNS, both spellings. `{:name :city}` binds each key to its own name; `{:name who}`
    ;;    renames. A map read is already total (D9), so this one needs no guard — the difference from
    ;;    the vector case is deliberate, not an oversight.
    (let {:name :city} { :name "Sabaka" :city "Sarny" })
    (console.log "map keys:" name city)

    (let {:name who} { :name "renamed" })
    (console.log "renamed:" who)

    ;; A missing key is nil rather than an error, on both backends.
    (let {:absent} { :name "x" })
    (console.log "missing key:" absent)
)

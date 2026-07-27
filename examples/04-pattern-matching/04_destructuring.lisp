;; Destructuring & Pattern Binding
;;
;; This example demonstrates:
;; - Vector/array destructuring
;; - Map/object destructuring
;; - Nested destructuring
;; - Destructuring in function parameters

(
    ;; 1. Basic vector destructuring
    (console.log "--- Vector Destructuring ---")
    (let point [10 20])
    (let [x y] point)
    (console.log "Coordinates: x=" x ", y=" y)

    ;; 2. Partial vector destructuring
    (let rgb [255 128 64])
    (let [r g b] rgb)
    (console.log "Color: R=" r " G=" g " B=" b)

    ;; 3. Destructuring with rest element (if supported)
    (let numbers [1 2 3 4 5])
    (let [first second ...rest] numbers)
    (console.log "First:" first "Second:" second "Rest:" rest)

    ;; 4. Basic map destructuring
    (console.log "--- Map Destructuring ---")
    (let person {:name "Alice" :age 30 :city "NYC"})
    (let {:name :age} person)
    (console.log "Person: " name ", Age: " age)

    ;; 5. Map destructuring with aliases
    (let user {:firstName "Bob" :lastName "Smith"})
    (let {:firstName first-name :lastName last-name} user)
    (console.log "User:" (+ first-name " " last-name))

    ;; 6. Nested destructuring
    (console.log "--- Nested Destructuring ---")
    (let user-profile {
        :user {:name "Charlie" :id 123}
        :settings {:theme "dark" :lang "en"}
    })
    ;; Aliased, because `name` is already bound by section 4 and D10 says a `let` binds ONCE -- so the
    ;; nested key has to land under a name of its own rather than shadowing.
    (let {:user {:name user-name :id user-id} :settings {:theme}} user-profile)
    (console.log "User:" user-name "(ID:" user-id ") Theme:" theme)

    ;; 7. Destructuring in function parameters
    (console.log "--- Destructuring in Functions ---")
    (fn print-point [[x y] <- [Int Int]] -> Void (
        (console.log "Point: (" x ", " y ")")
    ))
    (print-point [5 10])
    (print-point [100 200])

    ;; 8. Destructuring map in function parameters
    ;;
    ;; `person["name"]`, not `person:name`. The colon path is NOT a feature (D39) -- it lexed as one
    ;; identifier and emitted `person3aname`, an undefined name, which is why this section used to die
    ;; at run time rather than be rejected.
    (fn greet [person <- {:name <- String :age <- Int}] -> Void (
        (console.log "Hello" person["name"] "you are" person["age"] "years old")
    ))
    (greet {:name "Diana" :age 28})
    (greet {:name "Eve" :age 35})

    ;; 9. Destructuring in loop
    (console.log "--- Destructuring in Loops ---")
    (let points [[1 2] [3 4] [5 6]])
    (for :each [x y] :from points :then (
        (console.log "x=" x " y=" y)
    ))

    ;; 10. Reading with a default
    ;;
    ;; There is no get-with-default form. `(config:host "default-host")` was reaching for one through
    ;; the same non-existent colon path as section 8. What the language has is the TOTAL accessor:
    ;; `(get m k)` answers nil for a missing key where the indexer `m[k]` raises KeyError, and the
    ;; default is then an ordinary nil check.
    (console.log "--- Reading with a Default ---")
    (let config {:host "localhost" :port 8080})
    (let raw-host (get config "host"))
    (let raw-timeout (get config "timeout"))
    (let host (if (== raw-host nil) "default-host" raw-host))
    (let timeout (if (== raw-timeout nil) 5000 raw-timeout))
    (console.log "Host:" host "Timeout:" timeout)

    ;; 11. Swapping with destructuring
    ;;
    ;; The classic `[a b] = [b a]` is an ASSIGNMENT to two names that already exist. l-lang has no
    ;; destructuring assignment today, and D10 says a `let` binds once -- so `(let [a b] [b a])` is
    ;; `'a' is already declared in this scope`, not a swap. The swap is spelled as what it actually is
    ;; here: a new binding whose pattern reads the old pair in the other order. Whether the language
    ;; wants destructuring assignment as well is an open question, not something this file decides.
    ;; `left`/`right` and not `a`/`b`: section 2's `[r g b]` already bound `b` in this same scope, and
    ;; the top level IS one scope. Three of this file's five duplicate-declaration errors were that --
    ;; sections written independently, reusing the obvious short names.
    (console.log "--- Swap Pattern ---")
    (let left 1)
    (let right 2)
    (console.log "Before: a=" left " b=" right)
    (let [swapped-a swapped-b] [right left])
    (console.log "After: a=" swapped-a " b=" swapped-b)

    ;; 12. Multiple return value destructuring
    (console.log "--- Multiple Returns ---")
    (fn divide-with-remainder [a <- Int b <- Int] -> [Int Int] (
        (let quotient (/ a b))
        (let remainder (% a b))
        (return [quotient remainder])
    ))
    ;; `rem` and not `r`: section 2's `[r g b]` already took `r` in this same scope.
    (let [q rem] (divide-with-remainder 17 5))
    (console.log "17 / 5 = " q " remainder " rem)

    ;; 13. Destructuring in pattern matching
    (console.log "--- Destructuring in Pattern Matching ---")
    (let data {:type "user" :payload {:id 1 :name "Frank"}})
    (match data {
        {:type "user" :payload {:id :name}} => (
            (console.log "User data: ID=" id " Name=" name)
        )
        _ => (
            (console.log "Unknown data type")
        )
    })

    ;; 14. Complex nested destructuring
    (console.log "--- Complex Nested ---")
    (let result {
        :status "success"
        :data [
            {:id 1 :value "A"}
            {:id 2 :value "B"}
            {:id 3 :value "C"}
        ]
    })
    (let {:status :data items} result)
    (console.log "Status:" status)
    (for :each x :from items :then (
        (console.log "Item ID=" x["id"] " Value=" x["value"])
    ))
)

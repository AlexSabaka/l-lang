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
    (let {:user {:name :id} :settings {:theme}} user-profile)
    (console.log "User:" name "(ID:" id ") Theme:" theme)

    ;; 7. Destructuring in function parameters
    (console.log "--- Destructuring in Functions ---")
    (fn print-point [[x y] <- [Int Int]] -> Void (
        (console.log "Point: (" x ", " y ")")
    ))
    (print-point [5 10])
    (print-point [100 200])

    ;; 8. Destructuring map in function parameters
    (fn greet [person <- {:name <- String :age <- Int}] -> Void (
        (console.log "Hello" person:name "you are" person:age "years old")
    ))
    (greet {:name "Diana" :age 28})
    (greet {:name "Eve" :age 35})

    ;; 9. Destructuring in loop
    (console.log "--- Destructuring in Loops ---")
    (let points [[1 2] [3 4] [5 6]])
    (for :each [x y] :from points :then (
        (console.log "x=" x " y=" y)
    ))

    ;; 10. Destructuring with default values (if supported)
    (console.log "--- Destructuring with Defaults ---")
    (let config {:host "localhost" :port 8080})
    (let host (config:host "default-host"))  ;; Use value if exists, else default
    (let timeout (config:timeout 5000))      ;; Default if not in config
    (console.log "Host:" host "Timeout:" timeout)

    ;; 11. Swapping with destructuring
    (console.log "--- Swap Pattern ---")
    (let a 1)
    (let b 2)
    (console.log "Before: a=" a " b=" b)
    (let [a b] [b a])
    (console.log "After: a=" a " b=" b)

    ;; 12. Multiple return value destructuring
    (console.log "--- Multiple Returns ---")
    (fn divide-with-remainder [a <- Int b <- Int] -> [Int Int] (
        (let quotient (/ a b))
        (let remainder (% a b))
        (return [quotient remainder])
    ))
    (let [q r] (divide-with-remainder 17 5))
    (console.log "17 / 5 = " q " remainder " r)

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

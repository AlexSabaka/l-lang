;; Optional Values & Mutability
;;
;; This example demonstrates:
;; - Optional type handling (using union with nil)
;; - Mutable vs immutable bindings
;; - Mutation operations
;; - nil checking and default values

(
    ;; 1. Optional values (using union types)
    (console.log "--- Optional Values ---")
    (let maybe-number (| Int nil))  ;; Can be Int or nil
    (maybe-number := 42)
    (if (== maybe-number nil)
        (console.log "Value is nil")
        (console.log "Value is:" maybe-number))

    ;; 2. Function returning optional
    (fn find-user [id <- Int] -> (| {:name String :email String} nil) (
        (if (== id 1)
            (return {:name "Alice" :email "alice@example.com"})
            (return nil))
    ))
    
    (let user1 (find-user 1))
    (let user2 (find-user 999))
    
    (if (!= user1 nil)
        (console.log "Found user:" user1)
        (console.log "User 1 not found"))
    
    (if (== user2 nil)
        (console.log "User 2 not found"))

    ;; 3. Safe optional access
    (console.log "--- Safe Optional Access ---")
    (fn get-user-email [id <- Int] -> String (
        (let user (find-user id))
        (if (== user nil)
            (return "unknown@example.com")
            (return user:email))
    ))
    
    (let email1 (get-user-email 1))
    (let email2 (get-user-email 999))
    (console.log "Email 1:" email1)
    (console.log "Email 2:" email2)

    ;; 4. Mutable vs immutable variables
    (console.log "--- Mutability ---")
    
    ;; Immutable binding (let)
    (let immutable-val 10)
    ;; immutable-val := 20  ;; Would cause error
    (console.log "Immutable:" immutable-val)
    
    ;; Mutable binding (mut)
    (mut mutable-val 10)
    (mutable-val := 20)
    (console.log "Mutable (first):" mutable-val)
    (mutable-val := 30)
    (console.log "Mutable (second):" mutable-val)

    ;; 5. Mutable collections
    (console.log "--- Mutable Collections ---")
    (mut items [1 2 3])
    (console.log "Initial:" items)
    
    (items[0] := 100)
    (console.log "After index update:" items)
    
    (items.push 4)
    (console.log "After push:" items)

    ;; 6. Mutable map updates
    (console.log "--- Mutable Map ---")
    (mut config {:timeout 5000 :retries 3})
    (console.log "Initial config:" config)
    
    (config:timeout := 10000)
    (console.log "After update:" config)
    
    (config:debug := true)
    (console.log "After adding field:" config)

    ;; 7. Mutable parameters vs immutable
    (console.log "--- Mutation in Functions ---")
    (fn update-point [point <- {:x Int :y Int}] -> {:x Int :y Int} (
        ;; Parameters are immutable by default
        ;; Create new object instead of mutating
        (let updated {:x (* point:x 2) :y (* point:y 2)})
        (return updated)
    ))
    
    (let original {:x 5 :y 10})
    (let scaled (update-point original))
    (console.log "Original:" original)
    (console.log "Scaled:" scaled)

    ;; 8. Mutable local state in function
    (fn accumulate [values <- [Int]] -> Int (
        (mut total 0)
        (for :each val :from values :then (
            (total := (+ total val))
        ))
        (return total)
    ))
    
    (let sum (accumulate [10 20 30 40]))
    (console.log "Accumulated sum:" sum)

    ;; 9. Mutable reference behavior
    (console.log "--- Reference Mutation ---")
    (mut arr1 [1 2 3])
    (let arr2 arr1)          ;; arr2 refers to same array
    (arr1[0] := 999)
    (console.log "arr1:" arr1)
    (console.log "arr2:" arr2)  ;; Also shows mutation

    ;; 10. Optional with mutable
    (console.log "--- Optional Mutable ---")
    (mut cache (| String nil))
    (cache := nil)
    (console.log "Cache empty:" (== cache nil))
    
    (cache := "cached-value")
    (console.log "Cache set:" cache)
    
    (cache := nil)
    (console.log "Cache cleared:" (== cache nil))

    ;; 11. Optional in collection
    (let maybe-numbers [(| Int nil) (| Int nil) (| Int nil)])
    (maybe-numbers[0] := 100)
    (maybe-numbers[1] := nil)
    (maybe-numbers[2] := 200)
    (console.log "Optional array:" maybe-numbers)

    ;; 12. Pattern matching on optional
    (console.log "--- Match Optional ---")
    (fn format-number [n <- (| Int nil)] -> String (
        (match n
            [(nil match) (return "No value")]
            [(num <- Int) (return (+ "Number: " num))]
        )
    ))
    
    (console.log (format-number 42))
    (console.log (format-number nil))

    ;; 13. Chaining optional operations
    (console.log "--- Optional Chain ---")
    (fn get-user-age [id <- Int] -> (| Int nil) (
        (let user (find-user id))
        (if (== user nil)
            (return nil)
            ;; In real code, would look up age from database
            (return 30))
    ))
    
    (let age (get-user-age 1))
    (if (!= age nil)
        (console.log "User age:" age "years")
        (console.log "Could not determine age"))
)

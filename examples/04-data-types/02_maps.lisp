;; Maps & Dictionary Operations
;;
;; This example demonstrates:
;; - Map literals with keyword and string keys
;; - Map access and mutation
;; - Nested maps
;; - Map operations (keys, values, entries)

(
    ;; 1. Map with keyword keys
    (let person {:name "Alice" :age 30 :city "New York"})
    (console.log "Person:" person)
    (console.log "Name:" person.name)
    (console.log "Age:" person["age"])

    ;; 2. Map with string keys
    (let config {"host" "localhost" "port" 8080 "debug" true})
    (console.log "Config:" config)
    (console.log "Host:" config["host"])

    ;; 3. Empty map and insertion
    (let empty {})
    (empty["key"] := "value")
    (empty.status := "active")
    (console.log "Populated map:" empty)

    ;; 4. Nested maps
    (let nested {:user {:name "Bob" :contact {:email "bob@example.com"}}})
    (console.log "Nested map:" nested)
    (console.log "User name:" nested.user.name)
    (console.log "Email:" nested["user"]["contact"]["email"])

    ;; 5. Map iteration
    (console.log "--- Iterate Map ---")
    (let settings {:theme "dark" :lang "en" :sound true :brightness 100})
    
    ;; Iterate over entries
    (for :each [key val] :from settings.entries :then (
        (console.log (+ key ": " val))
    ))

    ;; 6. Get all keys
    (let keys (settings.keys))
    (console.log "Keys:" keys)

    ;; 7. Get all values
    (let values (settings.values))
    (console.log "Values:" values)

    ;; 8. Check if key exists
    (let data {:a 1 :b 2 :c 3})
    (if (data.hasKey "a")
        (console.log "Key 'a' exists with value:" data.a))

    ;; 9. Map with computed keys
    (let computed {})
    (let key1 "setting1")
    (let key2 "setting2")
    (computed[key1] := 100)
    (computed[key2] := 200)
    (console.log "Computed keys map:" computed)

    ;; 10. Map as function parameter
    (fn process-config [config <- {:host <- String :port <- Int}] -> String (
        (return (+ config.host ":" config.port))
    ))
    (let result (process-config {:host "api.example.com" :port 443}))
    (console.log "Processed:" result)

    ;; 11. Update nested map
    (let user {:profile {:age 25 :score 1000}})
    (user["profile"]["score"] := 1500)
    (console.log "Updated user:" user)
)

;; Null/Nil Handling
;;
;; This example demonstrates:
;; - nil vs false vs empty
;; - Nil checking
;; - Null coalescing
;; - Default values

(
    ;; 1. nil vs false vs empty values
    (console.log "--- nil vs Other Falsy Values ---")
    (let nil-value nil)
    (let false-value false)
    (let empty-string "")
    (let zero 0)
    (let empty-array [])
    
    (console.log "nil is:" nil-value)
    (console.log "false is:" false-value)
    (console.log "empty string is:" empty-string)
    (console.log "zero is:" zero)
    (console.log "empty array is:" empty-array)

    ;; 2. nil checking with ==
    (console.log "--- Nil Checking ---")
    (let maybe-value nil)
    
    (if (== maybe-value nil)
        (console.log "Value is nil"))
    
    (if (!= maybe-value nil)
        (console.log "Value is not nil")
        (console.log "Value is definitely nil"))

    ;; 3. Truthiness checks (if-based)
    (console.log "--- Truthiness ---")
    (if nil
        (console.log "nil is truthy")
        (console.log "nil is falsy"))
    
    (if false
        (console.log "false is truthy")
        (console.log "false is falsy"))
    
    (if 0
        (console.log "0 is truthy")
        (console.log "0 is falsy"))
    
    (if ""
        (console.log "empty string is truthy")
        (console.log "empty string is falsy"))

    ;; 4. Returning nil from functions
    (console.log "--- Functions Returning Nil ---")
    (fn get-value-or-nil [condition <- Bool] -> (| String nil) (
        (if condition
            (return "has value")
            (return nil))
    ))
    
    (let val1 (get-value-or-nil true))
    (let val2 (get-value-or-nil false))
    
    (if (== val1 nil)
        (console.log "val1 is nil")
        (console.log "val1: " val1))
    
    (if (== val2 nil)
        (console.log "val2 is nil"))

    ;; 5. Default values for nil
    (console.log "--- Default Values ---")
    (fn get-config [key <- String] -> (| String nil) (
        (let data {:host "localhost" :port "8080"})
        (return data[key])
    ))
    
    (let host (get-config "host"))
    (let timeout (get-config "timeout"))
    
    (let host-val (if (== host nil) "default-host" host))
    (let timeout-val (if (== timeout nil) "5000" timeout))
    
    (console.log "Host:" host-val)
    (console.log "Timeout:" timeout-val)

    ;; 6. Nil in collections
    (console.log "--- Nil in Collections ---")
    (let items [1 nil 3 nil 5])
    (console.log "Array with nils:" items)
    
    (for :each item :from items :then (
        (if (== item nil)
            (console.log "Found nil")
            (console.log "Found value:" item))
    ))

    ;; 7. Nil in maps/objects
    (console.log "--- Nil in Objects ---")
    (let user {:name "Alice" :email nil :age 30})
    (console.log "User object:" user)
    
    (if (== user:email nil)
        (console.log "Email not provided"))

    ;; 8. Safe navigation (manual)
    (console.log "--- Safe Property Access ---")
    (fn get-user-city [user <- (| {:name String :location {:city String}} nil)] -> String (
        (if (== user nil)
            (return "unknown"))
        
        (if (== user:location nil)
            (return "no location"))
        
        (return user:location:city)
    ))
    
    (let user1 {:name "Bob" :location {:city "NYC"}})
    (let user2 {:name "Charlie" :location nil})
    (let user3 nil)
    
    (console.log "City 1:" (get-user-city user1))
    (console.log "City 2:" (get-user-city user2))
    (console.log "City 3:" (get-user-city user3))

    ;; 9. nil coalescing pattern
    (console.log "--- Nil Coalescing ---")
    (fn choose-value [primary <- (| Int nil) :secondary <- Int] -> Int (
        (if (!= primary nil)
            (return primary)
            (return secondary))
    ))
    
    (let val1 (choose-value nil :secondary 42))
    (let val2 (choose-value 10 :secondary 42))
    (console.log "Coalesced 1:" val1)  ;; 42
    (console.log "Coalesced 2:" val2)  ;; 10

    ;; 10. Array filtering out nils
    (console.log "--- Filter Out Nils ---")
    (let maybe-items [1 nil 2 nil 3 nil 4])
    (let filtered [])
    (for :each item :from maybe-items :then (
        (if (!= item nil)
            (filtered.push item))
    ))
    (console.log "Filtered (no nils):" filtered)

    ;; 11. nil in pattern matching
    (console.log "--- Pattern Matching with Nil ---")
    (fn describe-value [val <- (| String Int nil)] -> String (
        (match val
            [(nil match) (return "nothing")]
            [(s <- String) (return (+ "text: " s))]
            [(n <- Int) (return (+ "number: " n))]
        )
    ))
    
    (console.log (describe-value nil))
    (console.log (describe-value "hello"))
    (console.log (describe-value 42))

    ;; 12. Nil propagation
    (console.log "--- Nil Propagation ---")
    (fn chain-operations [initial <- (| Int nil)] -> (| Int nil) (
        (if (== initial nil)
            (return nil))
        
        (let step1 (* initial 2))
        (if (> step1 100)
            (return nil))  ;; Return nil if condition fails
        
        (let step2 (+ step1 10))
        (return step2)
    ))
    
    (console.log "Chain 1:" (chain-operations 20))    ;; 50
    (console.log "Chain 2:" (chain-operations 100))   ;; nil
    (console.log "Chain 3:" (chain-operations nil))   ;; nil

    ;; 13. Initializing with nil
    (console.log "--- Initialization ---")
    (let cache (| String nil))
    (cache := nil)  ;; Explicitly set to nil
    (console.log "Cache initialized to nil:" (== cache nil))
    
    ;; Later set value
    (cache := "cached-data")
    (console.log "Cache has value:" cache)
    
    ;; Clear cache
    (cache := nil)
    (console.log "Cache cleared:" (== cache nil))
)

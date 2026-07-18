;; Conditional Expressions - if/else
;;
;; This example demonstrates:
;; - if/else basic usage
;; - Nested conditionals
;; - if as expression (returns value)

(
    ;; 1. Basic if/else
    (let age 25)
    (if (>= age 18)
        (console.log "You are an adult")
        (console.log "You are a minor"))

    ;; 2. if/else as expression (returns value)
    (let status (if (> age 65)
        "Senior"
        (if (>= age 18)
            "Adult"
            "Minor")))
    
    (console.log "Status:" status)

    ;; 3. Nested if/else
    (let score 85)
    (let grade (if (>= score 90)
        "A"
        (if (>= score 80)
            "B"
            (if (>= score 70)
                "C"
                "F"))))
    
    (console.log '"Score {(score)} is grade {(grade)}")

    ;; 4. if without else (returns nil if condition false)
    (let message (if (> age 30)
        "You are experienced"))
    
    (console.log "Message:" message)
)

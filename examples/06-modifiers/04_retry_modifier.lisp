(
    ;; Retry modifier for demonstration
    (defmodifier retry [])
    
    ;; Simple functions to show retry modifier syntax
    (fn :retry task-one [] -> String
        "Task one completed"
    )
    
    (fn :retry task-two [] -> String
        "Task two completed"
    )
    
    (console.log "Testing retry modifier (demo):")
    (console.log "Task 1:" (task-one))
    (console.log "Task 2:" (task-two))
    (console.log "Task 1 again:" (task-one))
)
(
    ;; 1. Async Function Definition
    (fn :async fetch-fake-data [id] (
        ;; Simulate network delay (assuming a sleep function exists or just returning)
        (return (+ "Data_for_" id))
    ))

    ;; 2. Async Consumer
    (fn :async main-task [] (
        (console.log "Fetching...")
        
        ;; Await Expression
        (let data (await (fetch-fake-data 42)))
        
        (console.log '"Received: {(data)}")
        (return data)
    ))

    ;; Execute
    (main-task)
)
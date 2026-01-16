(
    ;; Basic defmodifier example - identity modifier that does nothing
    (defmodifier identity [])
    
    ;; Function with identity modifier (should work like normal function)
    (fn :identity greet [name <- String] -> String
        (+ "Hello, " name "!")
    )
    
    ;; Function without modifier for comparison  
    (fn greet-normal [name <- String] -> String
        (+ "Hi, " name "!")
    )
    
    (console.log "Identity modifier:")
    (console.log (greet "Alice"))
    (console.log "Normal function:")  
    (console.log (greet-normal "Bob"))
)
(
    ;; 1. Base Class
    (defclass Animal
        (let :ctor name)
        (fn speak [] (std.console.log "Generic noise...")))

    ;; 2. Inheritance
    (defclass Dog :extends Animal
        (let :ctor breed)
        
        ;; Method Override
        (fn speak [] (
            (std.console.log '"{(this.name)} the {(this.breed)} says Woof!")
        ))
    )

    ;; 3. Instantiation & Usage
    (let my-pet (Dog "Buddy" "Golden Retriever"))
    
    (my-pet.speak) ;; Prints: Buddy the Golden Retriever says Woof!
    
    ;; 4. Accessing properties
    (std.console.log my-pet.name)
)
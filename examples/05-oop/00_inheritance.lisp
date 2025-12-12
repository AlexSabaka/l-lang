(
    ;; 1. Base Class
    (defclass Animal
        (let :ctor name)
        (fn speak [] (console.log "Generic noise...")))

    ;; 2. Inheritance
    (defclass Dog :extends Animal
        (let :ctor breed)
        
        ;; Method Override
        (fn speak [] (
            (console.log '"{(this.name)} the {(this.breed)} says Woof!")
        ))
    )

    ;; 3. Instantiation & Usage
    (let my-pet (Dog "Buddy" "Golden Retriever"))
    
    (my-pet.speak call) ;; Prints: Buddy the Golden Retriever says Woof!
    
    ;; 4. Accessing properties
    (console.log my-pet.name)
)
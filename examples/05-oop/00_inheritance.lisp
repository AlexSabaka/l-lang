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
    (let my-pet (new Dog "Buddy" "Golden Retriever"))
    
    (my-pet.speak) ;; Prints: Buddy the Golden Retriever says Woof!
    
    ;; 4. Accessing properties
    (console.log my-pet.name)

    ;; 5. Type Introspection
    (let my-pet-type (type my-pet))
    (let my-pet-parent-type (type my-pet-type["extends"]))
    (console.log
        "My pet is a"
        my-pet-type["name"]
        "which is a subclass of"
        my-pet-parent-type["name"])
)
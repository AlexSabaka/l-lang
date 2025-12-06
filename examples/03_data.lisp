(
    ;; 1. Vectors
    (let numbers [10 20 30 40])
    (std.console.log (elem numbers 2)) ;; Should print 30

    ;; 2. Maps & Nesting
    (let sloth-profile 
        { :name "Sid"
          :stats { :speed 0
                   :charisma 100 }
          :foods ["Leaves" "Berries"]
        })

    ;; 3. Deep Access
    (std.console.log sloth-profile.name)
    (std.console.log sloth-profile.stats.charisma)
    
    ;; 4. Vector methods (assuming std lib shim)
    (let first-food (head sloth-profile.foods))
    (std.console.log '"First food: {(first-food)}")
)
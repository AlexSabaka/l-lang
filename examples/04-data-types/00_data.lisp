(
    ;; 1. Vectors
    (let numbers [10 20 30 40])
    (std.console.log "Vector numbers:" numbers)
    (std.console.log "Second value (should be 30):" numbers[2])

    ;; 2. Maps & Nesting
    (let sloth-profile 
        { :name "Sid"
          :stats { :speed 0
                   :charisma 100 }
          :foods ["Leaves" "Berries"]
        })

    ;; 3. Deep Access
    (std.console.log "Name:" sloth-profile.name)
    (std.console.log "Stats Charisma:" sloth-profile.stats.charisma)
    
    ;; 4. Vector methods (assuming std lib shim)
    (let first-food (head sloth-profile.foods))
    (std.console.log '"First food: {(first-food)}")
)
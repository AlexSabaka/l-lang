(
    ;; 1. Vectors
    (let numbers [10 20 30 40])
    (console.log "Vector numbers:" numbers)
    (console.log "Second value (should be 30):" numbers[2])

    ;; 2. Maps & Nesting
    (let sloth-profile 
        { :name "Sid"
          :stats { :speed 0
                   :charisma 100 }
          :foods ["Leaves" "Berries"]
        })

    ;; 3. Deep Access
    (console.log "Name:" sloth-profile.name)
    (console.log "Stats Charisma:" sloth-profile.stats.charisma)
    
    ;; 4. Vector methods (assuming std lib shim)
    (let first-food (head sloth-profile.foods))
    (console.log f"First food: {(first-food)}")
)
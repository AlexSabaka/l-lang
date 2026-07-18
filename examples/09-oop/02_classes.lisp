;; Object-Oriented Programming Basics
;;
;; This example demonstrates:
;; - Class definitions
;; - Constructor and methods
;; - Instance properties
;; - Method invocation

(
    ;; 1. Simple class with constructor
    (console.log "--- Simple Class ---")
    (defclass Point
        (let :ctor x <- Int)
        (let :ctor y <- Int)
        
        (fn to-string [] -> String (
            (return (+ "Point(" this.x ", " this.y ")"))
        ))
    )
    
    (let p (Point 10 20))
    (console.log p.x p.y)
    (console.log (p.to-string))

    ;; 2. Class with getters
    (console.log "--- Class with Getters ---")
    (defclass Circle
        (let :ctor radius <- Int)
        
        (fn get-area [] -> Real (
            (return (* 3.14159 (* this.radius this.radius)))
        ))
        
        (fn get-circumference [] -> Real (
            (return (* 2 (* 3.14159 this.radius)))
        ))
    )
    
    (let c (Circle 5))
    (console.log "Radius:" c.radius)
    (console.log "Area:" (c.get-area))
    (console.log "Circumference:" (c.get-circumference))

    ;; 3. Class with multiple methods
    (console.log "--- Class with Methods ---")
    (defclass Rectangle
        (let :ctor width <- Int)
        (let :ctor height <- Int)
                
        (fn get-area [] -> Int (
            (return (* this.width this.height))
        ))
        
        (fn get-perimeter [] -> Int (
            (return (* 2 (+ this.width this.height)))
        ))
        
        (fn resize [new-width <- Int new-height <- Int] -> Void (
            (this.width := new-width)
            (this.height := new-height)
        ))
        
        (fn describe [] -> String (
            (let area (this.get-area))
            (let perimeter (this.get-perimeter))
            (return (+ this.width "x" this.height " (area=" area ", perimeter=" perimeter ")"))
        ))
    )
    
    (let rect (Rectangle 10 5))
    (console.log "Rectangle:" (rect.describe))
    (rect.resize 15 10)
    (console.log "After resize:" (rect.describe))

    ;; 4. Class with private-like behavior (convention)
    (console.log "--- Class with Helper Methods ---")
    (defclass BankAccount
        (let :ctor account-number <- String)
        (let :ctor balance <- Real)

        (fn deposit [amount <- Real] -> Void (
            (if (> amount 0)
                (this.balance := (+ this.balance amount))
                (console.log "Invalid amount"))
        ))
        
        (fn withdraw [amount <- Real] -> Boolean (
            (if (&& (> amount 0) (>= this.balance amount)) (
                (this.balance := (- this.balance amount))
                (return true)
            ))
            (return false)
        ))
        
        (fn get-balance [] -> Real (
            (return this.balance)
        ))
        
        (fn get-statement [] -> String (
            (return (+ "Account: " this.account-number " Balance: $" this.balance))
        ))
    )
    
    (let account (BankAccount "ACC123" 1000.0))
    (console.log (account.get-statement))
    (account.deposit 500.0)
    (console.log "After deposit:" (account.get-balance))
    (let success (account.withdraw 300.0))
    (console.log "Withdrawal successful:" success)
    (console.log (account.get-statement))

    ;; 5. Class with initialization list
    (console.log "--- Initialization ---")
    (defclass Counter
        (let :ctor value <- Int)
        (let :ctor max-value <- Int)
                
        (fn increment [] -> Void (
            (if (< this.value this.max-value)
                (this.value := (+ this.value 1)))
        ))
        
        (fn reset [] -> Void (
            (this.value := 0)
        ))
        
        (fn get-value [] -> Int (
            (return this.value)
        ))
    )
    
    (let counter (Counter 0 10))
    (counter.increment)
    (console.log "After increment:" (counter.get-value))
    (counter.reset)
    (console.log "After reset:" (counter.get-value))

    ;; 6. Using class instances in collections
    (console.log "--- Classes in Collections ---")
    (let points [(Point 0 0) (Point 10 20) (Point 5 15)])
    (console.log "Points array:")
    (for :each p :from points :then (
        (console.log (p.to-string))
    ))

    ;; 7. Creating factory functions
    (console.log "--- Factory Pattern ---")
    (fn create-circle [radius <- Int] -> Circle (
        (return (Circle radius))
    ))
    
    (let c1 (create-circle 3))
    (let c2 (create-circle 7))
    (console.log "Circle 1 area:" (c1.get-area))
    (console.log "Circle 2 area:" (c2.get-area))

    ;; 8. Class with computed properties
    (console.log "--- Computed Properties ---")
    (defclass Person
        (let :ctor first-name <- String)
        (let :ctor last-name <- String)
        (let :ctor birth-year <- Int)
        
        (fn get-full-name [] -> String (
            (return (+ this.first-name " " this.last-name))
        ))
        
        (fn get-age [current-year <- Int] -> Int (
            (return (- current-year this.birth-year))
        ))
        
        (fn get-info [] -> String (
            (let name (this.get-full-name))
            (let age (this.get-age 2026))
            (return (+ name " (" age " years old)"))
        ))
    )

    (defclass Person2
        (let :ctor first-name <- String)
        (let :ctor last-name <- String)
        (let :ctor birth-year <- Int)

        (mut :private full-name <- String "")
        (mut :private age <- Int 0)
        
        (fn :private :ctor initialize-person [] -> Void (
            (this.full-name := (+ this.first-name " " this.last-name))
        ))
        
        (fn :private :ctor initialize-age [] -> Void (
            (this.age := (- 2026 this.birth-year))
        ))
        
        (fn get-info [] -> String (
            (+ this.full-name " (" this.age " years old)")
        ))
    )
    
    (let person (Person "John" "Doe" 1990))
    (console.log (person.get-info))

    (let person2 (Person2 "John" "Doe" 1990))
    (console.log (person2.get-info))
)

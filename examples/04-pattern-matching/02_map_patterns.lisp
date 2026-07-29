(
    (defclass BankAccount
        (let :ctor balance <- Real)
        (let :ctor history <- Any)

        (fn apply [event] -> BankAccount (
            (match event {
                { :type "DEPOSIT" :amount amt } => 
                    (BankAccount (+ this.balance amt) this.history)
                
                { :type "WITHDRAW" :amount amt } => 
                    (BankAccount (- this.balance amt) this.history)
                
                _ => this
            })
        ))
    )

    (fn apply [acc e] (acc.apply e))

    ;; Initial State
    (let account (BankAccount 0 []))

    ;; Events
    (let evt1 { :type "DEPOSIT" :amount 100 })
    (let evt2 { :type "WITHDRAW" :amount 30 })
    (let evt3 { :type "DEPOSIT" :amount 50 })

    ;; Apply via Pipeline
    (let final-account
        (account 
            |> (.apply evt1)
            |> (.apply evt2)
            |> (.apply evt3)
        ))

    (console.log f"Final Balance (should be 120): {(final-account.balance)}")
)
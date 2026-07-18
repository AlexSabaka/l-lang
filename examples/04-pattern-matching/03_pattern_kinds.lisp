(
    ;; 1. Literal matching
    (let x 3)
    (let message (match x {
        1 => "one"
        2 => "two"
        3 => "three"
        _ => "other"
    }))
    (console.log message)

    ;; 2. Vector pattern matching
    (let vec [1 2 3])
    (let vec-match (match vec {
        [1 2 3]   => "exact match"
        [1 _ _]   => "starts with 1"
        [1 ...]   => "1 and more"
        []        => "empty"
        _         => "anything else"
    }))
    (console.log "Vector match:" vec-match)

    ;; 3. Map destructuring
    (let user { :name "Alice" :age 30 :role "admin" })
    (let user-info (match user {
        { :name n :role "admin" } => '"Admin: {(n)}"
        { :name n :age a }        => '"User {(n)} age {(a)}"
        _                         => "Unknown user"
    }))
    (console.log user-info)

    ;; 4. Guard patterns with type checks
    (let value 42)
    (let result (match value {
        x :is Int      => "It's an integer"
        x :is String   => "It's a string"
        x :is Boolean  => "It's a boolean"
        _              => "Unknown type"
    }))
    (console.log "Type match:" result)

    ;; 5. Complex nested destructuring
    (let person {
        :name "Bob"
        :address { :city "NYC" :zip "10001" }
        :hobbies ["reading" "coding"]
    })

    (let location (match person {
        { :address { :city "NYC" } } => "Lives in New York"
        { :address { :city c } }     => ('"Lives in {(c)}")
        _                            => "Unknown location"
    }))
    (console.log location)
)

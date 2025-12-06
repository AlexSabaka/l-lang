(
    (let x 3)
    (let y 
        (match x {
            1 => ("1 1 1 1")
            2 => ("2 2 2 2")
            3 => ("3 3 3 3")
            4 => ("4 4 4 4")
            _ => ('"{(x)} LOL {(x)}")
            }))
    (std.console.log y)


    (match (Number (std.math.random 0 100))
        {
            (||(= _ 0)
               (< _ -0)) => (std.console.log "unborn")
               (< _ 10) => (std.console.log "just a baby")
               (< _ 20) => (std.console.log "yo yo yo a teenager here")
               (< _ 40) => (std.console.log "nothing spectacular a middleage person")
               (< _ 60) => (std.console.log "i see youve seen some shit in life")
               (< _ 90) => (std.console.log "have you bought yourself a place at graveyard?")
                  _     => (std.console.log "how da fck are you still alive?")
        }
    )
)
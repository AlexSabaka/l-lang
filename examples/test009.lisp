(
    (match (Number (std.console.readln "Age?\n>> "))
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
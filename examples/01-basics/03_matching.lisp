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
    (console.log y)

    (match (Math.random 0 100)
        {
            (< _ 0)  => (console.log "unborn")
            (< _ 10) => (console.log "just a baby")
            (< _ 20) => (console.log "yo yo yo a teenager here")
            (< _ 40) => (console.log "nothing spectacular a middleage person")
            (< _ 60) => (console.log "i see youve seen some shit in life")
            (< _ 90) => (console.log "have you bought yourself a place at graveyard?")
            _        => (console.log "how da fck are you still alive?")
        }
    )
)
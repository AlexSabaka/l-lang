(
    (let x (Number (std.console.readln "Integer: ")))
    (let y 
        (match x {
        1 => ("1 1 1 1")
        2 => ("2 2 2 2")
        3 => ("3 3 3 3")
        4 => ("4 4 4 4")
        _ => ('"{(x)} LOL {(x)}")
        }))
    (std.console.log y)
)
(
    (defclass Yeller
        (let :ctor what)
        (fn yell [times] (
            (when (<= times 0) (return))
            (std.console.log this.what)
            (this.yell (- times 1))
        ))
    )

    (defclass LouderYeller :extends Yeller 
        (fn yell [times] (
            (when (<= times 0) :then return)
            (let local-val (when (<= times 5) :then "WOW!!!"))
            (std.console.log '"*** {(this.what)} *** {(local-val)}")
            (this.yell (- times 1))
        ))
    )

    (let ∆ 0)

    (let … (LouderYeller "I AM A DOG!!!"))
    (std.console.log …)
    (….yell 10)

    (std.console.log "What is your name?")
    (let 🙃 (call std.console.read))
    (let kkk (match (🙃.toLowerCase "") {
        "alex" => "DOG"
        "oleh" => "HUMAN"
        _      => "PES PATRON"
    }))
    (std.console.log '"{(🙃)} is a {(kkk)}")
)
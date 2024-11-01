(
    (let !ret! 0)

    (fn ` [] (throw "Unexpected"))
    (fn :operator ?? [a b] (return b))

    (fn factorial [x]
        (
            (when (<= x 0) (return 1))
            (return (* x (factorial (- x 1))))))

    ;; (fn :operator == [a <- Number, b <- Number] (return (eq a b)))
    ;; (fn :operator  > [a <- Number, b <- Number] (return (gt a b)))
    ;; (fn :operator  < [a <- Number, b <- Number] (return (lt a b)))
    ;; (fn :operator >= [a <- Number, b <- Number] (return (ge a b)))
    ;; (fn :operator <= [a <- Number, b <- Number] (return (le a b)))
 
    (when (> 5 2) (std.console.log "!!! 5 > 2 !!!!"))

    (let ƒ (std.console.readln "Please enter an integer number: "))

    (std.console.log '"Factorial of {(ƒ)} is {(factorial ƒ)}")

    (let map1
        {   :name "Alex Sabaka"
            :age 30
            :inline 
            {   :ok "OK"
                :lol (+ "LO" "L")}
            :foo (fn [x] (return (* x x)))})

    (std.console.log map1)
    (std.console.log map1.inline.lol)
    (std.console.log (map1.foo 4))

    (defclass Food
        (let :ctor title)
        (let :ctor description)
        (fn out [] (std.console.log '"I'm a food known as '{(this.title)}' or if to be precise '{(this.description)}'")))

    (defclass Peach :extends Food
        (let :public peach-is "Princess"))

    (let apple (Food "Apple" "Red Granny Apple"))
    (std.console.log apple)
    (apple.out 0)

    (let pp (Peach "Peach" "The Best"))
    (std.console.log pp)
    (std.console.log pp.peach-is)
    (pp.out 9)

    (fn test [arg1 arg2] (return (+ arg1 arg2)))

    (let fn2 (fn [arg1 arg2] (return '"{(arg1)} +++ {(arg2)}")))

    (let name "Alex Sabaka")
    (let age ["very" 30])
    (let map2
        {   :age (elem age 1)
            :name name
            :inline { :ok "OK"
                      :lol "LOL"}})

    (std.console.log map1)
    (std.console.log (== map2 map1))
    (match age
        {   1113   => (std.console.log "ELELELE")
            29     => (std.console.log "Young")
            (a 30) => (std.console.log '"Old {(a)}")
            _      => (std.console.log "IDK")})

    (let arr [12 23 34 4])
    (match arr
        {   [4  3 2 1] => (std.console.log "NO")
            [12 _ c _] => (std.console.log '"___{(c)}NONO")
            _  => (std.console.log "IDK")})

    (std.console.log (test 123 321))
    (std.console.log (fn2 123 321))

    (when (== !ret! 0) (std.console.log "HOORAY!"))

)

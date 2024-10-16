(
    ;; (using { format } from pretty-format)
    (let !ret! 0)

    (fn ` [] (throw "Unexpected"))
    (fn :operator ?? [a b] (return b))

    (fn factorial [x] (
        (when (<= x 0) (return 1))
        ;; (when (== x 30) (`))
        (return (mul x (factorial (sub x 1))))
    ))

    (fn :operator == [a b] (return (eq a b)))
    (fn :operator > [a b] (return (gt a b)))
    (fn :operator < [a b] (return (lt a b)))
    (fn :operator >= [a b] (return (ge a b)))
    (fn :operator <= [a b] (return (le a b)))

    (when (> 5 2) (std.console.log "5 > 2 !!!!"))


    (std.console.log '"Please enter an integer number:")
    (let ƒ (std.io.readln 0))

    (std.console.log '"Factorial of {(ƒ)} is {(factorial ƒ)}")

    (let map1 {
        :name "Alex Sabaka"
        :age 30
        :inline {
            :ok "OK"
            :lol (add "LO" "L")
        }
        :foo (fn [x] (return (mul x x)))
    })
    (std.console.log map1)
    (std.console.log map1.inline.lol)
    (std.console.log (map1.foo 4))

    (let push (fn [a i] (Array.prototype.push.apply a [i])))
    (let arrr [1 2 3])
    (std.console.log (push arrr "ITEM"))
    (std.console.log (elem arrr 3))
    (std.console.log arrr)

    (defclass Food
        (let :ctor title)
        (let :ctor description)
        (fn out [] (
            (std.console.log '"I'm a food known as '{(this.title)}' or if to be precise '{(this.description)}'")
        ))
    )

    (defclass Peach :extends Food
        (let :public peach-is "Princess")
    )

    (let apple (Food "Apple" "Red Granny Apple"))
    (std.console.log apple)
    (apple.out 0)

    (let pp (Peach "Peach" "The Best"))
    (std.console.log pp)
    (std.console.log pp.peach-is)
    (pp.out 9)

    (fn test [arg1 arg2] (return (add arg1 arg2)))

    (let fn2 (fn [arg1 arg2] (return '"{(arg1)} +++ {(arg2)}")))

    (let name "Alex Sabaka")
    (let age ["very" 30])
    (let map2 {
        :age (elem age 1)
        :name name
        :inline {
            :ok "OK"
            :lol "LOL"
        }
    })
    (std.console.log map1)
    (std.console.log (== map2 map1))
    (match age {
        1113    => (std.console.log "ELELELE")
        29      => (std.console.log "Young")
        (a 30)  => (std.console.log '"Old {(a)}")
        _       => (std.console.log "IDK")
    })
    (let arr [12 23 34 4])
    (match arr {
        [4 3 2 1] => (std.console.log "NO")
        [12 _ c _] => (std.console.log '"___{(c)}NONO")
        _  => (std.console.log "IDK")
    })
    (std.console.log (test 123 321))
    (std.console.log (fn2 123 321))

    (when (== !ret! 0) (std.console.log "HOORAY!"))

    (let x 3)
    (let y 4)

    (let \_/ (fn [x y] js'(return Math.sqrt(x * x + y * y))))
    (std.console.log (\_/ x y))

    (fn * [a b] (return (mul a b)))
    (fn + [a b] (return (add a b)))

    (let %%% infix'(x * x + y * y))
    (std.console.log %%%)
)
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

    (when (> 5 2) (std.io.print "5 > 2 !!!!"))


    (std.io.print '"Please enter an integer number:")
    (let ƒ (std.io.readln 0))

    (std.io.print '"Factorial of {(ƒ)} is {(factorial ƒ)}")

    (let map1 {
        :name "Alex Sabaka"
        :age 30
        :inline {
            :ok "OK"
            :lol (add "LO" "L")
        }
        :foo (fn [x] (return (mul x x)))
    })
    (std.io.print map1)
    (std.io.print map1.inline.lol)
    (std.io.print (map1.foo 4))

    (let push (fn [a i] (Array.prototype.push.apply a [i])))
    (let arrr [1 2 3])
    (std.io.print (push arrr "ITEM"))
    (std.io.print (elem arrr 3))
    (std.io.print arrr)

    (defclass Food
        (let :ctor title)
        (let :ctor description)
        (fn out [] (
            (std.io.print '"I'm a food known as '{(this.title)}' or if to be precise '{(this.description)}'")
        ))
    )

    (defclass Peach :extends Food
        (let :public peach-is "Princess")
    )

    (let apple (Food "Apple" "Red Granny Apple"))
    (std.io.print apple)
    (apple.out 0)

    (let pp (Peach "Peach" "The Best"))
    (std.io.print pp)
    (std.io.print pp.peach-is)
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
    (std.io.print map1)
    (std.io.print (== map2 map1))
    (match age {
        1113    => (std.io.print "ELELELE")
        29      => (std.io.print "Young")
        (a 30)  => (std.io.print '"Old {(a)}")
        _       => (std.io.print "IDK")
    })
    (let arr [12 23 34 4])
    (match arr {
        [4 3 2 1] => (std.io.print "NO")
        [12 _ c _] => (std.io.print '"___{(c)}NONO")
        _  => (std.io.print "IDK")
    })
    (std.io.print (test 123 321))
    (std.io.print (fn2 123 321))

    (when (== !ret! 0) (std.io.print "HOORAY!"))

    (let x 3)
    (let y 4)

    (let \_/ (fn [x y] js'(return Math.sqrt(x * x + y * y))))
    (std.io.println (\_/ x y))

    (fn * [a b] (return (mul a b)))
    (fn + [a b] (return (add a b)))

    (let %%% infix'(x * x + y * y))
    (std.io.println %%%)
)
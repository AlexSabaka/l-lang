(
    (import "std/io")

    (let name "World")
    (let punct "!")

    (print "Hello, {0}!" name)
    (print "Hello, {0}{1}" name punct)
    (print "Format: {0} = {1} + {2}" "result" 2 3)
    (print "Multiple: {0}, {1}, {2}, {3}" "a" "b" "c" "d")
)
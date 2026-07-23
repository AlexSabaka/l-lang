;; Support module for 21_imported_error_tower: a TWO-LEVEL typed-error hierarchy in another file, the
;; shape std/core/errors has (ValueError -> IndexError, with structured data). Definitions only.
(
    (defclass ValueError :extends Error (let :ctor message <- String))
    (defclass IndexError :extends ValueError (let :ctor index <- Int))
    (defclass KeyError :extends ValueError (let :ctor key <- String))

    (fn at [xs <- Int[] i <- Int] -> Int (
        (if (>= i xs.length) (throw (new IndexError '"index {(i)} out of range" i)))
        (return xs[i])
    ))
    (export ValueError IndexError KeyError at)
)

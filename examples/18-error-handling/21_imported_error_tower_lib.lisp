;; Support module for 21_imported_error_tower: a TWO-LEVEL typed-error hierarchy in another file, the
;; shape std/core/errors has (SeqFault -> Oob, with structured data). Definitions only.
(
    (defclass SeqFault :extends Error (let :ctor message <- String))
    (defclass Oob :extends SeqFault (let :ctor index <- Int))
    (defclass NoKey :extends SeqFault (let :ctor key <- String))

    (fn at [xs <- Int[] i <- Int] -> Int (
        (if (>= i xs.length) (throw (new Oob '"index {(i)} out of range" i)))
        (return xs[i])
    ))
    (export SeqFault Oob NoKey at)
)

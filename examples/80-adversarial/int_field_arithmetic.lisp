;; ADVERSARIAL: `this.field` ARITHMETIC INSIDE A METHOD MUST STAY 64-BIT.
;;
;; D51 makes Int a 64-bit two's-complement value that WRAPS. The deprecated backend represents it as a
;; BigInt, which is arbitrary-precision, so every arithmetic site there has to be wrapped back by the
;; emitter. It does that for a local and for a plain field store -- both measured -- and NOT for
;; `this.field` inside a method:
;;
;;                      C                      JS
;;     after 1     -7046029254386353131   -7046029254386353000
;;     after 2      4354685564936845354  -14092058508772706000
;;
;; TWO defects in one value, and the first is the louder one. `…353000` is not a wrapped `…353131`, it
;; is a ROUNDED one: the operand went through `Number`, which has 53 bits of mantissa, so the low
;; digits are simply gone. The second is the missing wrap -- `-14092058508772706000` is past
;; INT64_MIN, so it was never reduced modulo 2^64 at all.
;;
;; THIS IS WHY `std/math/random` COMPUTES A DIFFERENT STREAM ON EACH BACKEND. Its SplitMix64 seeding is
;; exactly this shape (`(this.sm := (+ this.sm -7046029254386353131))`), and the same SplitMix64
;; written with a module-level `mut` instead is byte-identical on both -- which is how the fault was
;; narrowed to the receiver rather than the arithmetic.
;;
;; Graded on C only; D66 freezes the other backend. C is checked against the algorithm in
;; `random_seeded_stream.lisp`, not against itself.
(
    (defclass Acc
        (mut v <- Int 0)

        ;; The SplitMix64 golden-ratio increment, which is what makes this the real shape rather than a
        ;; contrived one: it is negative, and its magnitude needs more than 53 bits.
        (fn bump [] -> Int (
            (this.v := (+ this.v -7046029254386353131))
            (return this.v))))

    (let a (new Acc))
    (a.bump)
    (console.log "one step :" a.v)

    ;; The second step is the one that must WRAP: two of that increment overflow INT64_MIN, so a
    ;; backend that never reduces modulo 2^64 answers a number no Int can hold.
    (a.bump)
    (console.log "two steps:" a.v)

    ;; The same arithmetic through a LOCAL, which is correct on both backends and is therefore the
    ;; control: it says the defect is the RECEIVER, not the operator or the literal.
    (mut local -7046029254386353131)
    (local := (+ local -7046029254386353131))
    (console.log "local    :" local)
    (console.log "done")
)

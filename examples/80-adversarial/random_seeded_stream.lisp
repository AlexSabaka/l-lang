;; CONFORMANCE: `std/math/random`'s seeded stream, checked against the ALGORITHM.
;;
;; The module's own header states the design: "SEEDED DETERMINISM IS THE API (the ManualClock
;; philosophy). `(Random seed)` is a reproducible stream, and a program that seeds it is a golden of
;; itself." Nothing in `examples/` called `Random` at all, so that claim had never been checked -- and
;; it was FALSE across backends.
;;
;; EVERY NUMBER BELOW COMES FROM AN INDEPENDENT IMPLEMENTATION of SplitMix64 seeding + xoshiro256**,
;; not from this compiler. That is the only way a PRNG golden can be honest: its output is not
;; something a reader can derive by inspection, so capturing what the compiler printed would freeze
;; whatever it happened to do. The reference reproduces the seeding words too --
;; s0 = -4767286540954276203 for seed 42 -- and C matches all of it exactly.
;;
;; GRADED ON C ONLY. The deprecated backend computes a DIFFERENT stream from the same seed, because
;; `this.field` arithmetic inside a method loses its BigInt there -- see
;; `int_field_arithmetic.lisp`, which isolates that in four lines. D66 freezes it.
(
    (import "std/math/random")

    ;; The first three outputs for seed 42. Three, not one: xoshiro256** advances four state words per
    ;; step, and a seeding that filled them in the wrong ORDER can still produce a correct first value.
    (let a (new Random 42))
    (console.log "n1  :" (a.next))
    (console.log "n2  :" (a.next))
    (console.log "n3  :" (a.next))

    ;; `real` takes the TOP 53 bits -- the IEEE-double-exact slice -- so it pins the shift, not just
    ;; the raw word. A fresh generator, because the one above has been advanced three times.
    (let b (new Random 42))
    (console.log "real:" (b.real))

    ;; `int-in` and `bool` off the SAME first word, so a divergence in either is the derivation and not
    ;; the generator.
    (let c (new Random 42))
    (console.log "1..6:" (c.int-in 1 7))
    (let d (new Random 42))
    (console.log "bool:" (d.bool))

    ;; REPRODUCIBILITY, which is the actual claim: same seed, same stream; a different seed, a
    ;; different one. Without the second line, a generator that ignored its seed entirely would pass.
    (let e (new Random 42))
    (let f (new Random 42))
    (console.log "same seed agrees:" (== (e.next) (f.next)))
    (let g (new Random 7))
    (let h (new Random 42))
    (console.log "seeds differ    :" (!= (g.next) (h.next)))
    (console.log "done")
)

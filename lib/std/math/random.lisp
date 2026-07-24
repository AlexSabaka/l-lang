;; std/math/random -- a seeded, deterministic pseudo-random generator.
;;
;; xoshiro256** (the generator) seeded by SplitMix64 (David Blackman & Sebastiano Vigna, public domain).
;; Both are a few shifts, xors and wrapping multiplies -- exactly what D51's wrapping int64 and D61's
;; bit operators (incl. the new logical `ushr`) exist for -- so the sequence is byte-for-byte identical
;; on both backends, and identical to the reference implementation. That is the design: SEEDED
;; DETERMINISM IS THE API (the ManualClock philosophy). `(Random seed)` is a reproducible stream, and a
;; program that seeds it is a golden of itself. `default-random` seeds from the clock for the casual
;; caller and is the one non-reproducible surface.
;;
;; The SplitMix64 constants have the high bit set, so they are written as SIGNED DECIMALS (hex literals
;; do not codegen yet -- ELL0100 visitHexNumber); the bit pattern is identical (D51 two's-complement).
(
    (defclass Random
        (mut :ctor seed <- Int)
        (mut s0 <- Int 0)
        (mut s1 <- Int 0)
        (mut s2 <- Int 0)
        (mut s3 <- Int 0)
        (mut sm <- Int 0)                     ;; the running SplitMix64 state, used only at seeding

        ;; `:ctor` initializer -- fill the four xoshiro words from four SplitMix64 outputs of the seed.
        (fn :ctor seed-state [] (
            (this.sm := this.seed)
            (this.s0 := (this.splitmix))
            (this.s1 := (this.splitmix))
            (this.s2 := (this.splitmix))
            (this.s3 := (this.splitmix))))

        ;; one SplitMix64 step (advances this.sm). GOLDEN=0x9E3779B97F4A7C15, C1=0xBF58476D1CE4E5B9,
        ;; C2=0x94D049BB133111EB -- as signed decimals below.
        (fn splitmix [] -> Int (
            (this.sm := (+ this.sm -7046029254386353131))
            (mut z this.sm)
            (z := (* (bxor z (ushr z 30)) -4658895280553007687))
            (z := (* (bxor z (ushr z 27)) -7723592293110705685))
            (return (bxor z (ushr z 31)))))

        (fn rotl [x <- Int k <- Int] -> Int (return (bor (shl x k) (ushr x (- 64 k)))))

        ;; xoshiro256** next: the raw 64-bit output as a signed Int.
        (fn next [] -> Int (
            (let result (* (this.rotl (* this.s1 5) 7) 9))
            (let t (shl this.s1 17))
            (this.s2 := (bxor this.s2 this.s0))
            (this.s3 := (bxor this.s3 this.s1))
            (this.s1 := (bxor this.s1 this.s2))
            (this.s0 := (bxor this.s0 this.s3))
            (this.s2 := (bxor this.s2 t))
            (this.s3 := (this.rotl this.s3 45))
            (return result)))

        ;; a Real in [0, 1) from the top 53 bits (the IEEE-double-exact slice).
        (fn real [] -> Real (return (/ (ushr (this.next) 11) 9007199254740992.0)))

        ;; a uniform Int in [lo, hi). Integer-only via the non-negative low 63 bits mod the range -- the
        ;; modulo bias is negligible for the index/dice ranges this serves (Lemire is a future upgrade).
        (fn int-in [lo <- Int hi <- Int] -> Int (return (+ lo (% (ushr (this.next) 1) (- hi lo)))))

        (fn bool [] -> Boolean (return (== (band (this.next) 1) 1)))

        ;; Fisher-Yates over a SHALLOW copy -- a new array, same elements, input untouched. The copy is
        ;; built by push (a concrete vector) rather than `.slice` (which returns a boxed value on C), and
        ;; the length `n` is COUNTED in the same loop rather than read from `.length`: `arr.length` yields
        ;; a host Number on JS that is not lifted to an Int, and mixing it with the BigInt from `next`
        ;; inside `int-in` diverges silently from C (a JS-backend gap, logged). A counted `n` is a real Int.
        (fn shuffle [arr <- Any[]] -> Any[] (
            (let out [])
            (mut n 0)
            (for :each x :from arr :then ((out.push x) (n := (+ n 1))))
            (for :init (mut i 0) :cond (< i (- n 1)) :step (i := (+ i 1)) :then (
                (let j (this.int-in i n))          ;; j in [i, n)
                (let tmp out[i])
                (out[i] := out[j])
                (out[j] := tmp)))
            (return out)))

        (fn choice [arr <- Any[]] -> Any (
            (mut n 0)
            (for :each x :from arr :then (n := (+ n 1)))
            (let idx (this.int-in 0 n))
            (return arr[idx]))))

    ;; a Random seeded from the wall clock -- convenient, but NOT reproducible.
    (fn default-random [] -> Random (return (Random (clock-ns "mono"))))

    (export Random default-random)
)

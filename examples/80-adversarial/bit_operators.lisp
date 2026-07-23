;; CONFORMANCE guard: the BIT OPERATORS (S2), and the three clauses of the ruling that can diverge.
;;
;; `band bor bxor bnot shl shr` are floor entries, so each is implemented TWICE -- BigInt on JS,
;; `int64_t` on C -- and every line below exists because a naive pair of implementations disagrees on
;; it. The easy cases (`(band 12 10)`) are here to anchor the reading; the interesting ones are 3-5.
;;
;; THE RULING: Int only, wrap at 64 bits, shift counts masked to 0-63, `shr` arithmetic.
;;
;; 3. SIXTY-FOUR-BIT WRAP is the clause JS cannot get for free. A BigInt is UNBOUNDED, so `(shl 1 63)`
;;    is a positive 9.2-quintillion there and INT64_MIN on C unless the shim masks with
;;    `BigInt.asIntN(64, ...)`. Same for `bnot` of a large value. D51 already rules Int as exact 64-bit
;;    on both backends; these lines are that ruling reaching the bit operators.
;;
;; 4. MASKED SHIFT COUNTS is the clause C cannot get for free, and it is the sharp one. C leaves a
;;    shift by >= the operand width UNDEFINED (C11 6.5.7p3) -- typically `x` on x86, because the CPU
;;    masks the count in hardware, and 0 on other targets -- while BigInt would shift by 64 quite
;;    happily and answer 0. So an unmasked `(shl 1 64)` is not merely a divergence, it is a
;;    divergence that changes with the MACHINE. Masking to `n & 63` is the cheapest total rule both
;;    can implement exactly, and it is what x86 and ARM already do.
;;
;; 5. ARITHMETIC `shr` -- the sign bit propagates. `(shr -256 4)` is -16, not a huge positive. Free on
;;    JS (BigInt `>>` is arithmetic by definition) and implementation-defined-but-universal on C
;;    (6.5.7p5), so it is stated rather than assumed.
;;
;; 6. Composition, because that is what the operators are FOR. An xorshift step is the shape
;;    `std/math/random` is waiting on, and it is the first thing that would break if wrap and shift
;;    disagreed by even one bit.
(
    ;; 1. the four bitwise operations, small positives -- the anchor.
    (console.log "1" (band 12 10) (bor 12 10) (bxor 12 10))

    ;; 2. complement and negative operands, i.e. two's complement really is the representation.
    (console.log "2" (bnot 0) (bnot 12) (band -1 255) (bor -2 1) (bxor -1 -1))

    ;; 3. SIXTY-FOUR-BIT WRAP. `(shl 1 63)` lands exactly on the sign bit.
    (console.log "3" (shl 1 62) (shl 1 63) (bnot 9223372036854775807))

    ;; 4. MASKED SHIFT COUNTS -- 64 masks to 0, 65 to 1. Never undefined, never machine-dependent.
    (console.log "4" (shl 1 64) (shl 1 65) (shr 256 64) (shl 1 0))

    ;; 5. ARITHMETIC shift right: the sign propagates, all the way.
    (console.log "5" (shr 256 4) (shr -256 4) (shr -1 63) (shr -1 0))

    ;; 6. COMPOSITION -- one xorshift step, the shape std/math/random needs.
    (let x 12)
    (console.log "6" (bxor x (shr x 1)) (band (bnot 0) 255))
)

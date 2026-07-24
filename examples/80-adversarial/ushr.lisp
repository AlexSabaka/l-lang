;; ADVERSARIAL: `ushr` is the LOGICAL (zero-filling) right shift; `shr` is ARITHMETIC (sign-propagating).
;; The difference is only visible on a value with the top bit set -- which is exactly where a random
;; generator or hash lives, and why xoshiro256 and SplitMix64 need a logical shift. Int is 64-bit
;; wrapping (D51), so both backends agree bit-for-bit: BigInt.asUintN on JS, (uint64_t) on C.
(
    ;; -256 = 0xFFFFFFFFFFFFFF00. shr keeps the sign (-16); ushr fills 0 from the top (a big positive).
    (console.log "neg:" (shr -256 4) (ushr -256 4))
    ;; (shl 1 63) is the sign bit (INT64_MIN). ushr 63 reads it back as 1, not sign-smeared to -1.
    (console.log "topbit:" (ushr (shl 1 63) 63) (shr (shl 1 63) 63))
    ;; on a non-negative value the two agree.
    (console.log "pos:" (shr 256 4) (ushr 256 4))
    ;; shift count masked to 0-63; a shift by 0 is the identity.
    (console.log "edges:" (ushr 42 0) (ushr -1 1))
)

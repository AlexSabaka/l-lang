;; std/math/random -- a seeded, deterministic generator (xoshiro256** over SplitMix64). Seeded
;; determinism IS the API: `(Random 42)` is a reproducible stream, byte-identical on both backends and
;; identical to the reference implementation (splitmix64(0) = 0xE220A8397B1DCDAF, verified).
(
    (import "std/math/random")

    ;; the reference stream from seed 42
    (let r (Random 42))
    (console.log "state:" r.s0 r.s1 r.s2 r.s3)
    (console.log "next:" (r.next) (r.next) (r.next))
    (console.log "real:" (r.real))
    (console.log "int-in:" (r.int-in 0 100) (r.int-in 10 20))
    (console.log "bool:" (r.bool))

    ;; shuffle returns a NEW array (input untouched); choice picks one -- a fresh independent stream
    (let g (Random 7))
    (let deck [1 2 3 4 5 6 7 8])
    (console.log "shuffle:" (g.shuffle deck))
    (console.log "orig:" deck)
    (console.log "choice:" (g.choice ["a" "b" "c" "d" "e"]))
)

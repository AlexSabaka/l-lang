;; A `defcast` cannot smuggle a value past a refinement (D46/B-3 + the D46 amend). The conversion
;; targets `uint8`, so `(cast<uint8> v)` is a coercion INTO a refined newtype and runs its range
;; check -- the same check `(let x <- uint8 …)` and `(x := …)` run, from the same helper.
;;
;; The body of the conversion is doing nothing wrong; the value it produces is simply out of range.
(
    (deftype uint8 <- Int :satisfies (0..255))

    (defclass Volume (let :ctor raw <- Int))
    (defcast :explicit [v <- Volume] -> uint8 v.raw)

    ;; In range: converts and prints.
    (let ok (Volume 255))
    (console.log "ok:" (cast<uint8> ok))

    ;; Out of range: dies at the conversion, not at some later use of the value.
    (let bad (Volume 256))
    (console.log "unreachable:" (cast<uint8> bad))
)

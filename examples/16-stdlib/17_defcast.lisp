;; `defcast` -- user-defined CONVERSIONS (D46/B-3). A conversion is keyed by its (source, target)
;; pair rather than by a name, the way an operator overload is keyed by its symbol: no identifier,
;; exactly one parameter, a return type, a body.
;;
;; This is not a narrowing cast. `(cast<T> x)` never reinterprets a value or asserts a type the
;; runtime carries no evidence for -- it RUNS a conversion the program declared. Testing a type is a
;; different question and `:of` answers it soundly.
;;
;; Exactly one of `:implicit`/`:explicit` is required. `:explicit` fires only where `(cast<T> x)` is
;; written; `:implicit` additionally fires at coercion sites on its own.
(
    (deftype uint8 <- Int :satisfies (0..255))

    (defclass Celsius (let :ctor degrees <- Real))
    (defclass Volume  (let :ctor raw <- Int))

    ;; A conversion between two user types' representations.
    (defcast :explicit [c <- Celsius] -> Real c.degrees)
    (let temp (Celsius 21.5))
    (console.log "celsius:" (cast<Real> temp))

    ;; A conversion whose TARGET is a refined newtype. The declared range is checked on the way in,
    ;; through the same coercion point `(let x <- uint8 …)` uses -- a conversion cannot smuggle a
    ;; value past a refinement.
    (defcast :explicit [v <- Volume] -> uint8 v.raw)
    (let vol (Volume 200))
    (console.log "volume:" (cast<uint8> vol))

    ;; The result is an ordinary value of the target type, and widens for arithmetic as ever.
    (console.log "widened:" (+ (cast<uint8> vol) 55))
)

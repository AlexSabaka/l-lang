;; ADVERSARIAL (parity guard -- C-correct, JS-wrong): `Int` is an exact 64-bit integer (D51).
;;
;; This is the FIRST guard in the tree where JS is the backend that is wrong. Every other one assumes
;; C is catching up; here C has been right since it existed (`int64_t`) and JS still uses an IEEE-754
;; double, so an integer past 2^53 simply cannot be represented.
;;
;; It exists because Fe has no other signal. The corpus's largest integer is 3628800, so a successful
;; migration to BigInt would otherwise look exactly like no migration at all -- every golden green
;; before and after. These lines are the difference.
;;
;; EXPECTED == golden (the exact values). ACTUAL under JS today: 9007199254740992 for all three of the
;; first lines, because f64 rounds 2^53+1 down to 2^53 and cannot represent the odd neighbour at all.
(
    ;; 2^53 is the last integer an f64 represents exactly; 2^53 + 1 is not.
    (console.log "2^53:    " 9007199254740992)
    (console.log "2^53+1:  " 9007199254740993)
    (console.log "sum:     " (+ 9007199254740992 1))

    ;; Well beyond the f64 integer range, but comfortably inside int64.
    (console.log "big:     " 1234567890123456789)
    (console.log "big+1:   " (+ 1234567890123456789 1))

    ;; Arithmetic that stays exact only with 64-bit integers.
    (let a 4611686018427387904)
    (console.log "a+a-1:   " (- (+ a a) 1))
)

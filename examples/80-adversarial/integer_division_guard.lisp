;; ADVERSARIAL: integer `/` and `%` are TOTAL functions of their emitted code (D85).
;;
;; `EmitCirToC` emitted raw `(a / b)` for statically-typed Int/Int. Raw C integer division is
;; UNDEFINED for two divisors, and undefined is not a value:
;;
;;   * b == 0            -- the same emitted translation unit answered 0 at -O0 and 1 at -O2 on
;;                          arm64, and the x86 IDIV instruction raises #DE and kills the process.
;;                          One program, three behaviours, chosen by host and optimiser.
;;   * INT64_MIN / -1    -- the true result is 2^63, which does not fit. D51 says Int WRAPS, but C
;;                          calls this undefined rather than wrapping, and `-fwrapv` does not help:
;;                          on x86 the hardware traps regardless.
;;
;; THE RULING (Sabaka): a zero divisor detectable at COMPILE TIME is a compile error (LL0244);
;; detected at RUN TIME it PANICS. A divisor is a contract the caller broke, not data to recover
;; from -- so this lands on the far side of D82's line from an out-of-range index, next to a
;; refinement violation. `ll_idiv`/`ll_imod` therefore do their own `exit`, exactly as
;; `ll_refine_check_int` does, and never route through the catchable `ll_trap`.
;;
;; THE OVERFLOW HALF IS NOT A NEW RULING. D51 already says Int is wrapping two's-complement, and both
;; backends already answered INT64_MIN here. The guard changes no observable value -- it stops the C
;; being undefined while producing it, by negating through `uint64_t`, which is the defined spelling
;; of the same bits.
;;
;; NOTE THE DIVERGENCE, which is deliberate. On JS `(/ 1 0)` throws a host BigInt `RangeError` that a
;; broad `catch :of Error` will swallow. That was never designed -- it is what the host does -- and
;; D66 freezes the JS backend, so the two now differ: C panics, JS catches. C is the ruled behaviour.
(
    ;; -- REAL division is untouched, and that is the boundary of the rule ---------------------------
    ;;
    ;; IEEE 754 defines these. They are not errors, they agree on both backends already, and a guard
    ;; that caught them would break conforming float arithmetic.

    (let zero-real 0.0)
    (console.log "real / 0.0 :" (/ 1.0 zero-real))
    (console.log "real % 0.0 :" (% 1.0 zero-real))

    ;; -- ordinary integer division, which must not have changed ------------------------------------
    ;;
    ;; The guard is ELIDED for a literal divisor that is neither 0 nor -1, so these emit a bare `/`.
    ;; Pinned because "add a guard" is exactly the kind of change that quietly alters rounding or
    ;; sign behaviour at the same time. C truncates toward zero and so does l-lang.

    (console.log "7 / 2      :" (/ 7 2) (% 7 2))
    (console.log "-7 / 2     :" (/ -7 2) (% -7 2))
    (console.log "7 / -2     :" (/ 7 -2) (% 7 -2))

    ;; -- the divisor that is not a literal, so the guard is really emitted --------------------------

    (let two 2)
    (console.log "by binding :" (/ 9 two) (% 9 two))

    ;; -- INT64_MIN / -1, the overflow case ---------------------------------------------------------
    ;;
    ;; D51's wrap value, computed through the guard rather than through undefined behaviour. `% -1` is
    ;; 0 for every numerator including INT64_MIN, so it needs no arithmetic at all.
    ;;
    ;; Both operands are BINDINGS: a literal `-1` divisor is the other case the emitter must not
    ;; elide the guard for, and section below covers that spelling.

    (let int-min -9223372036854775808)
    (let minus-one -1)
    (console.log "MIN / -1   :" (/ int-min minus-one))
    (console.log "MIN % -1   :" (% int-min minus-one))

    ;; A LITERAL `-1` divisor. The elision test has to exclude it -- `(/ int-min -1)` is the same
    ;; undefined division as above, written the way a reader would most likely write it.
    (console.log "MIN / lit  :" (/ int-min -1))
    (console.log "MIN % lit  :" (% int-min -1))

    ;; -- a zero divisor reached through a binding is NOT a compile error ----------------------------
    ;;
    ;; LL0244 is deliberately syntactic: only a literal `0` in divisor position is reported. Tracking
    ;; `(let z 0)` to its use needs constant propagation the type stage does not do, and a check that
    ;; fired on SOME constant zeros would be worse than one whose rule a reader can state. The runtime
    ;; guard is what covers the rest -- not exercised here, because this file has to finish.
    ;;
    ;; `(/ 1 0)` written directly is `LL0244`, pinned in `test:diagnostics` where a compile error can
    ;; be asserted without the file failing to run.

    (console.log "done")
)

;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): how a Real prints (D51).
;;
;; D51 rules that `number->string` is shortest-round-trip and names the JS
;; `Number.prototype.toString` result as THE SPEC. That covers the digits -- and C's `ll_fmt_double`
;; already gets those right, by trying %.15g/%.16g/%.17g and keeping the first that round-trips. What
;; it does not cover is WHEN to switch to exponential notation and how to spell the exponent, and the
;; two backends disagree on both:
;;
;;     0.000001   JS 0.000001    C 1e-06     <- different NOTATION, same value
;;     1e-7       JS 1e-7        C 1e-07     <- different SPELLING of the exponent
;;
;; ECMA-262's rule is a threshold on the decimal exponent: fixed notation while -6 < n <= 21,
;; exponential outside it, with no zero-padding in the exponent. `%g` uses a precision-derived
;; threshold instead, which is why it flips a decade early and pads to two digits.
;;
;; This is the "float-formatting differential" FLOOR.md lists as latent under Fe. It is a silent
;; wrong answer -- the value is right, the rendering is not -- which is the class the floor exists to
;; eliminate. EXPECTED == golden (the JS rendering, per D51).
(
    ;; Either side of the upper threshold (21).
    (console.log 1e20)
    (console.log 1e21)

    ;; Either side of the lower one (-6). The first is the one C renders in the wrong notation.
    (console.log 0.000001)
    (console.log 1e-7)

    ;; Exponent spelling: no zero padding, explicit sign.
    (console.log 1.5e300)
    (console.log 5e-324)

    ;; Ordinary values, and a negative below the threshold.
    (console.log 0.1)
    (console.log -0.000001234)
)

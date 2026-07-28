;; ADVERSARIAL: the mangler's hex escape must be SELF-DELIMITING, not merely underscore-aware.
;;
;; D84 made `mangleC` injective by escaping `_` to `__` and every other character to `_<hex>_`. The
;; TERMINATOR is the half that is easy to leave out -- the 2026-07-27 audit proposed escaping the
;; underscore alone -- and this file is the case that would still collide if it were:
;;
;;     x-ac    ->  x + _2d + ac   =  x_2dac      (`-` is U+002D, TWO hex digits)
;;     xⶬ   ->  x + _2dac      =  x_2dac      (that character is FOUR)
;;
;; A codepoint's hex is variable-length, so without a closing delimiter an escape run and a literal
;; run of hex digits are the same string. Non-ASCII identifiers lex, so this is reachable rather than
;; theoretical. With `_<hex>_` the two are `x_2d_ac` and `x_2dac_`.
;;
;; ORACLE-DIVERGENT (D86): the JS backend has the IDENTICAL collision -- `encodeIdentifier` maps both
;; names onto `x2dac` and emits `const x2dac` twice. It is caught there only because redeclaring a
;; `const` is a JavaScript syntax error, i.e. by accident rather than by design, and it is reported as
;; `ELL0101 the JS backend emitted code that is not valid JavaScript` -- a codegen bug, not a
;; diagnostic. D66 freezes that backend, so this file is graded on C alone.
(
    (let x-ac 10)
    (let xⶬ 20)
    (console.log "distinct:" x-ac xⶬ)

    ;; The kebab name and the escaped name must also stay distinct from the DOUBLED-underscore form,
    ;; which is the other branch of the same escape.
    (let x_ac 30)
    (console.log "all three:" x-ac xⶬ x_ac)
)

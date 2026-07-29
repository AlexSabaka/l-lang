;; ADVERSARIAL: A STRING IS A COUNTED BYTE RANGE, NOT A C STRING.
;;
;; The C backend built every string literal with `ll_str_lit`, which measures its argument with
;; `strlen` -- the one measurement a C string cannot make about an l-lang one. So a literal ended at
;; its first NUL, and the truncation was SILENT.
;;
;; The half that matters is not the length, it is the EQUALITY. `ll_str_eq` is `len == len &&
;; memcmp`, correct as written and correct for years -- but it was being handed two truncated
;; strings, so two DIFFERENT literals sharing a NUL prefix compared EQUAL. Measured before the fix:
;;
;;     (== "ab\x00cd" "ab\x00XY")   ->  true on C, false on JS
;;     "ab\x00cd".length            ->  2 on C, 5 on JS
;;
;; A comparison that answers "equal" for unequal inputs is the shape behind every length-confusion
;; CVE, and it is why the 2026-07-27 audit's triage named this one of the six as the one to fix
;; first. The fix states the byte count at the emission site; nothing in the runtime moved, because
;; everything downstream of construction was already counted rather than terminated.
;;
;; NOTHING HERE PRINTS A NUL. A golden is compared as text, so a raw NUL in expected output would be
;; a byte the diff cannot show and the terminal cannot render -- every assertion below reduces to a
;; length, a boolean, or a substring that excludes it.
(
    ;; -- the two literals from the measurement -------------------------------------------------------
    ;;
    ;; `a` and `b` agree on their first three characters and differ after. Truncated, both are `ab`.

    (let a "ab\x00cd")
    (let b "ab\x00XY")
    (let same "ab\x00cd")

    ;; `.length` answers in CHARACTERS (D52) and a NUL is one codepoint, so five.
    (console.log "length         :" a.length)

    ;; The truncation made this the string `ab`, so all three of these were wrong at once.
    (console.log "== \"ab\"        :" (== a "ab"))
    (console.log "shared prefix  :" (== a b))
    (console.log "identical      :" (== a same))

    ;; -- a MAP KEY is the same string, and keys are the emitter site that also changed ---------------
    ;;
    ;; Map lookup is `ll_str_eq` too, so two keys sharing a NUL prefix collided: the second `ll_map_set`
    ;; found the first key "equal" and OVERWROTE it. A one-entry map where the source wrote two.

    (let m {"k\x001" "one" "k\x002" "two"})
    (console.log "distinct keys  :" m["k\x001"] m["k\x002"])

    ;; -- and every operation that CONSUMES one was already correct -----------------------------------
    ;;
    ;; This is the point about scope: concat, slice and compare all work from `s->len`, so none of them
    ;; needed a change. The defect was entirely at construction, which is why the fix is one function.

    (let j (+ "a\x00" "b"))
    (console.log "concat length  :" j.length)
    (console.log "after the NUL  :" (a.substring 3 5))
    (console.log "ordering       :" (< "a\x00a" "a\x00b"))

    ;; -- the two spellings must decode to the same byte ----------------------------------------------
    ;;
    ;; `\x00` and `\u0000` take different branches of the one-pass decoder, and both once had a way to
    ;; produce a NUL by ACCIDENT -- `parseInt("", 16)` is NaN and `String.fromCharCode(NaN)` is NUL, so
    ;; a malformed escape decoded to the very byte this file is about. Guarded there, asserted here.

    (let x "q\x00r")
    (let uu "q\u0000r")
    (console.log "both spellings :" (== x uu) x.length)

    ;; -- interpolation carries it through, and reports its LENGTH rather than its bytes ---------------
    ;;
    ;; `f"…"` lowers to `ll_str_concat_n` over boxed literal parts, which is a second emitter site the
    ;; fix touched. Printing `a` itself would put a NUL in the golden; printing what it measures does not.

    (console.log "interpolated   :" f"{a.length} chars, {(== a b)} equal")
    (console.log "done")
)

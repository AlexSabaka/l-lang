;; CONFORMANCE guard: the codepoint floor (D52, Ff-1) -- a String is a sequence of Unicode SCALAR
;; VALUES, and both backends were wrong about that in different directions.
;;
;; The measurement that motivates the whole of Ff, taken before any of it was written:
;;
;;                        JS      C     D52
;;     (strlen "cafe'")    4      5      4      <- C counts BYTES
;;     (strlen "Privit")   6     12      6         (Cyrillic is two bytes per letter)
;;     (strlen "a<emo>b")  4      6      3      <- JS counts UTF-16 CODE UNITS
;;
;; So this is not "make C match JS". JS is right for Latin-1 and Cyrillic by accident -- one UTF-16
;; unit per codepoint below U+10000 -- and wrong the moment anything is astral. A floor both backends
;; are rebuilt onto is the only thing that answers all three rows.
;;
;; Unlike Fg's containers, this one genuinely had to grow the floor. `flatten` was rescued by
;; `(x :of Array)` and `includes` by `==`, both already-portable primitives under another name;
;; nothing in the language could ask what a string's third CHARACTER is, because every spelling that
;; exists answers in the host's own units.
;;
;; An Int, not a Char: a Char has no agreed rendering (the display formatter still has no JS arm for
;; one) and after D51 an Int is already distinguishable from a Real on both backends.
;;
;; Out of range is `-1`. A codepoint is non-negative by definition, so this is out of band rather
;; than the in-band lie D9 objects to -- and it is what lets a scanner look one character ahead
;; without a bounds test, exactly as `io.lisp` leans on `charAt` returning "".
;;
;; NOTE this file measures through the FLOOR primitives only. `std/string`'s `strlen` and the native
;; `.length` still answer in host units at this commit -- Ff-2 moves them -- so nothing here goes
;; through either, and the table above stays a finding rather than a golden.
(
    ;; U+0041 A, U+00E9 e-acute (2 bytes), U+0457 Cyrillic yi (2 bytes), U+20AC euro (3 bytes),
    ;; U+1F600 grinning face (4 bytes, and a SURROGATE PAIR on JS).
    (let mixed "Aéї€😀")

    (console.log "length:    " (codepoint-length mixed))
    (console.log "ascii:     " (codepoint-length "hello"))
    (console.log "empty:     " (codepoint-length ""))

    (console.log "cp 0:      " (codepoint-at mixed 0))
    (console.log "cp 1:      " (codepoint-at mixed 1))
    (console.log "cp 2:      " (codepoint-at mixed 2))
    (console.log "cp 3:      " (codepoint-at mixed 3))
    ;; The astral one. On JS this is index 4 only if the surrogate pair counts as ONE.
    (console.log "cp 4:      " (codepoint-at mixed 4))

    ;; Out of range, both ends.
    (console.log "past end:  " (codepoint-at mixed 5))
    (console.log "negative:  " (codepoint-at mixed -1))
    (console.log "empty at 0:" (codepoint-at "" 0))

    ;; Construction, and the round trip.
    (console.log "build:     " (string-from-codepoints [72 233 8364 128512]))
    (console.log "rebuilt:   " (string-from-codepoints [(codepoint-at mixed 0) (codepoint-at mixed 4)]))
    ;; Measured, not printed: an empty result would put trailing whitespace in the golden.
    (console.log "none:      " (codepoint-length (string-from-codepoints [])))

    ;; A lone surrogate is not a scalar value and has no UTF-8 encoding; both runtimes answer U+FFFD
    ;; rather than one throwing and the other emitting something unpaired.
    (console.log "surrogate: " (codepoint-length (string-from-codepoints [55296])))

    ;; The bytes-vs-codepoints gap itself, stated as an arithmetic fact rather than a comment: the
    ;; euro sign is one codepoint and three bytes.
    (console.log "one euro:  " (codepoint-length "€"))
)

;; CONFORMANCE guard: the NATIVE string members count characters, not bytes (D52, Ff-3).
;;
;; Ff-2 rebuilt `std/string` on the codepoint floor, but left the native members -- `.length`,
;; `.charAt`, `.slice`, `.indexOf`, `.padStart`, `.split ""`, and the indexer `s[i]` -- answering in
;; each backend's own units. On C that meant BYTES, which matches neither JS nor D52:
;;
;;                              JS       C before   D52
;;     "café".length            4        5          4
;;     "Привіт".length          6        12         6
;;     ("café".charAt 3)        é        <junk>     é      one byte, i.e. half an "é"
;;     ("café".padStart 6 "-")  --café   -café      --café C padded to a BYTE width
;;     ("Привіт".indexOf "в")   3        6          3      a byte offset is not a position
;;     "café"[3]                é        <junk>     é
;;
;; Bytes were strictly the worst of the three: a codepoint count agrees with JS for everything below
;; U+10000 and with D52 always, where a byte count agrees with nothing. So C moved, and this file is
;; entirely within the BMP -- every line here is green on BOTH backends now, and was C-red before.
;;
;; The astral case, where JS's UTF-16 code units diverge from D52 and C is the reference, is
;; `native_string_astral.lisp`. It is kept separate on purpose: that file is listed in js-status.ts,
;; and folding these lines into it would hide them behind a not-yet on the JS side.
;;
;; What did NOT need to change, and why: `.includes`, `.startsWith`, `.endsWith`, `.replace` and
;; `.split` on a non-empty separator all scan for a substring, and UTF-8 is SELF-SYNCHRONIZING -- a
;; continuation byte cannot be mistaken for a lead byte, so a valid encoded needle cannot match
;; starting inside a character. Only operations returning or taking a POSITION or a WIDTH were wrong.
;; The `dyn-` lines exercise the OTHER dispatch path. A member on a statically-known local is
;; resolved at compile time; on a boxed receiver -- an untyped parameter -- it goes through
;; `ll_dyn_method`, and that arm was fixed separately and later. `(x.length)` there returned a raw
;; byte count until F.2, so `"café"` measured 4 when read and 5 when called, on the same value in the
;; same program. `padStart`/`padEnd`/`lastIndexOf` had no dynamic arm at all and TRAPPED
;; ("no such method on this value") where the typed path worked.
(
    (fn dyn-len [x] (return (x.length)))
    (fn dyn-pad [x] (return (x.padStart 6 "-")))

    (let latin "café")
    (let cyr "Привіт")
    ;; Three "é" and one "x", so last-vs-first actually differ: 7 codepoints, 10 bytes.
    (let reps "éécaféx")

    (console.log "len-latin: " latin.length)
    (console.log "len-cyril: " cyr.length)

    (console.log "char-at:   " (latin.charAt 3))
    (console.log "indexer:   " latin[3])
    (console.log "get:       " (get latin 3))

    (console.log "slice:     " (latin.slice 0 3))
    (console.log "slice-cyr: " (cyr.slice 2 4))
    ;; Negative indices count back from the end -- in characters, like everything else.
    (console.log "slice-neg: " (cyr.slice -2 6))

    (console.log "index-of:  " (cyr.indexOf "в"))
    (console.log "index-miss:" (cyr.indexOf "zz"))
    ;; `.indexOf` was converted to codepoints in Ff-3; `.lastIndexOf`, one function below it in
    ;; runtime.c, was not -- it returned the raw byte offset 9 where the character index is 6.
    (console.log "last-of:   " (reps.lastIndexOf "x"))
    (console.log "last-acc:  " (reps.lastIndexOf "é"))
    (console.log "last-miss: " (reps.lastIndexOf "zz"))

    (console.log "pad-start: " (latin.padStart 6 "-"))
    (console.log "pad-end:   " (latin.padEnd 6 "-"))

    ;; An empty separator splits into CHARACTERS. C split into bytes, so this was 5 pieces of mojibake.
    (console.log "split-emp: " (latin.split ""))

    ;; Controls: substring scanning was already correct on a byte scan, and stays untouched.
    ;; The dynamic dispatch path, on the same values.
    (console.log "dyn-len:   " (dyn-len latin))
    (console.log "dyn-pad:   " (dyn-pad latin))

    (console.log "includes:  " (latin.includes "fé"))
    (console.log "starts:    " (cyr.startsWith "Пр"))
    (console.log "split-sep: " (cyr.split "і"))
)

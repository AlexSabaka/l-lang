;; ADVERSARIAL (parity guard -- C-correct, JS-divergent): native string members past U+FFFF.
;;
;; The residual gap after Ff-3, and the whole of it. C's native string surface now counts CHARACTERS
;; (`native_string_codepoints.lisp` pins that, and it is green on both). JS's still counts UTF-16
;; CODE UNITS, so it agrees with D52 for everything below U+10000 and disagrees the moment a
;; character needs a surrogate pair:
;;
;;                            JS        C      D52
;;     "a<emo>b".length        4         3      3
;;     ("a<emo>b".charAt 1)    <half>    <emo>  <emo>    a lone surrogate is not a character
;;     ("a<emo>b".indexOf "b") 3         2      2
;;     ((split "") count)      4         3      3
;;
;; NOT FIXED, and the reason is that the fix has no good shape. C's members are OUR implementation --
;; moving them was a change to `runtime.c` and nothing else. JS's are the HOST's: `s.length` compiles
;; to a property read, so making it count characters means routing every member read through a
;; receiver-aware helper. Doing that only where the checker typed the receiver `String` would be
;; worse than the status quo -- a typed receiver would answer 3 and an untyped one 4, so the language
;; would disagree with ITSELF depending on inference, which is the failure mode `native_search_numeric`
;; already documents for `.includes`. Doing it unconditionally means a runtime type test on all 78
;; `.length` sites in the corpus, most of which are arrays.
;;
;; The language's own spellings are correct on both backends and are the supported answer:
;; `std/string`'s `strlen`/`char-at`/`substr`/`pad-start` and `std/seq`'s `length`, which dispatches
;; on `(coll :of String)` precisely so this gap does not reach it. The `seq-len` line below is the
;; control that proves it -- it is 3 on both backends, in the same file where `.length` is not.
;;
;; EXPECTED == golden. ACTUAL under JS today: every `native-` line answers in UTF-16 code units.
(
    (import "std/seq")

    ;; U+1F600, four bytes in UTF-8 and a SURROGATE PAIR in UTF-16.
    (let s "a😀b")

    ;; The control, and the point: the language's own `length` is right on both backends.
    (console.log "seq-len:      " (length s))

    (console.log "native-len:   " s.length)
    (console.log "native-char:  " (s.charAt 1))
    (console.log "native-index: " s[1])
    (console.log "native-slice: " (s.slice 1 2))
    (console.log "native-of:    " (s.indexOf "b"))
    (console.log "native-pad:   " (s.padStart 5 "-"))
    (console.log "native-split: " (length (s.split "")))
)

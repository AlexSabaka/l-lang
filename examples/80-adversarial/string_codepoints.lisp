;; CONFORMANCE guard: `std/string` measures and indexes in CODEPOINTS, and cases in ASCII (D52, Ff-2).
;;
;; Every function in `std/string` used to be a one-line delegation to a JavaScript string method, so
;; each backend answered in its own units. What this file pins, and what each backend said before:
;;
;;                            JS        C       D52
;;     (strlen "cafe'")        4        5        4       C counted BYTES
;;     (strlen "Privit")       6       12        6
;;     (strlen "a<emo>b")      4        6        3       JS counted UTF-16 CODE UNITS
;;     (char-at "a<emo>b" 1)   half     junk     <emo>   a surrogate / a lead byte
;;     (pad-start "cafe'" 6)   --cafe'  -cafe'   --cafe' C padded to a BYTE width
;;
;; JS is right below U+10000 by accident -- one UTF-16 unit per codepoint -- and wrong the moment
;; anything is astral, so neither backend was the reference. Both are rebuilt on `codepoint-*`.
;;
;; ------------------------------------------------------------------------------------------------
;; THE TWO LINES THAT LOOK LIKE BUGS AND ARE NOT
;;
;;     (upcase "cafe'")   is "CAFe'", NOT "CAFE'"
;;     (upcase "Privit")  is unchanged
;;
;; Case mapping is ASCII-ONLY on both backends, ruled rather than inherited. Before this, JS said
;; `CAFÉ` and C said `CAFé` -- the divergence was already there, and the choice was which one becomes
;; the rule. C's wins because it IS a rule: JS's answer came from `toUpperCase`, which is ICU- and
;; locale-version-dependent, i.e. the exact class of "conformance means chasing a host forever" that
;; D55 rejected for `util.inspect`.
;;
;; D52 asked for a vendored simple-case table instead, and that is still the right long-term answer.
;; It is also ~1400 entries with conditional and locale-sensitive cases, vendored TWICE and kept in
;; step, for a corpus containing exactly one non-ASCII string literal. When the table lands it
;; replaces `ascii-upper`/`ascii-lower` and this guard changes with it, on purpose.
;;
;; `trim` is the same ruling: the four ASCII whitespace characters, not the ~25 of Unicode
;; White_Space that JS's `.trim` removes. `trim-nbsp` is the discriminating case -- a NO-BREAK SPACE
;; (U+00A0) survives, so the trimmed string is 3 characters and not 2.
;; ------------------------------------------------------------------------------------------------
(
    (import "std/core/string")

    ;; U+0041 A, U+00E9 (2 bytes), U+0457 (2 bytes), U+20AC (3 bytes), U+1F600 (4 bytes, and a
    ;; surrogate PAIR on JS).
    (let mixed "Aéї€😀")

    (console.log "len-latin:  " (strlen "café"))
    (console.log "len-cyril:  " (strlen "Привіт"))
    (console.log "len-astral: " (strlen "a😀b"))

    (console.log "char-at:    " (char-at "a😀b" 1))
    ;; Past the end is "", not a throw -- measured rather than printed, so the golden has no
    ;; trailing whitespace.
    (console.log "char-at-oob:" (strlen (char-at "a😀b" 3)))

    (console.log "substr:     " (substr mixed 1 4))
    (console.log "substr-astr:" (substr "a😀b" 1 2))

    (console.log "upcase:     " (upcase "café"))
    (console.log "upcase-cyr: " (upcase "Привіт"))
    (console.log "downcase:   " (downcase "CAFÉ"))

    (console.log "trim:       " (trim "  hi  "))
    ;; U+00A0 NO-BREAK SPACE, built rather than typed so the intent is unmistakable. JS's native
    ;; `.trim` would strip it and answer 2.
    (console.log "trim-nbsp:  " (strlen (trim (+ (string-from-codepoints [160]) "hi"))))

    ;; Width is a count of CHARACTERS. C measured "café" as 5 bytes and padded one short.
    (console.log "pad-start:  " (pad-start "café" 6 "-"))
    (console.log "pad-end:    " (pad-end "é" 4 "ab"))
    (console.log "repeat:     " (repeat "é" 3))

    ;; Controls for the delegations that were deliberately NOT rewritten. A substring predicate is
    ;; already codepoint-correct on a byte scan, because UTF-8 is self-synchronizing: a valid encoded
    ;; needle cannot match starting inside a character.
    (console.log "contains:   " (contains "café" "fé"))
    (console.log "starts-with:" (starts-with "😀ok" "😀"))
)

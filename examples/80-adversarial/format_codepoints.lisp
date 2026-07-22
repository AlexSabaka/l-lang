;; CONFORMANCE guard: `print`'s `{N}` substitution scans CODEPOINTS (D52 / FLOOR.md 3.6, Ff-4).
;;
;; `print_positional_format.lisp` pins the substitution RULES -- escapes, repeats, the throw on a
;; missing argument -- and every one of its format strings is ASCII, so it says nothing about what a
;; character is. This file is the other half.
;;
;; `format-args` used to scan with `msg.length` and `(msg.charAt i)`, and Ff-3 moved both of those
;; underneath it: C's `.charAt` became a codepoint WALK, so a scanner calling it twice per position
;; went from O(n) to O(n^2) -- for every `print` in the language. Measured at 4000 characters, 20
;; calls: 0.20s before, unmeasurable after. Nothing in the corpus formats a long string, which is why
;; that needed measuring rather than noticing.
;;
;; It also left the one construct where the two backends still disagree sitting in the middle of the
;; language's most-used function: `.length` and `.charAt` count UTF-16 code units on JS past U+FFFF
;; (see `native_string_astral.lisp`). The old scanner survived that by LUCK -- it appended the two
;; surrogate halves on consecutive iterations, so they reconstituted into the original character.
;; Library code above the floor should not depend on luck about a known divergence.
;;
;; Now it decodes once with `string-to-codepoints`, scans an `Int[]` comparing integers, accumulates
;; the result as codepoints, and encodes once. Linear on both backends, and portable by construction:
;; nothing in the path touches a native string member.
;;
;; The `{{`/`}}` escapes and the digit scan are the parts that must not drift, because both do
;; ARITHMETIC on positions -- the escape needs a one-character lookahead (`-1` past the end now,
;; where `charAt` gave `""`), and the index is accumulated with `c - 48` rather than a `DIGITS`
;; table lookup.
(
    (import "std/io")

    ;; Non-ASCII in the LITERAL text around a placeholder.
    (print "café {0}" 7)
    (print "Привіт, {0}!" "світ")

    ;; Astral: a 4-byte character on C, a surrogate PAIR on JS, on both sides of a placeholder.
    (print "😀 {0} 😀" [1 2])

    ;; A placeholder immediately adjacent to a multi-byte character -- no separating space, so an
    ;; off-by-one in the scan lands inside the character rather than next to it.
    (print "é{0}é" 1)

    ;; The escapes, with the lookahead reading across a multi-byte character.
    (print "é{{0}}é {0}" 5)
    (print "{{é}}")

    ;; A multi-DIGIT index, so the `c - 48` accumulation is exercised past one digit, and a repeat of
    ;; the same index (the `replace`-only-the-first bug this file's sibling was written for).
    (print "{10} {0} {10}" "a" "b" "c" "d" "e" "f" "g" "h" "i" "j" "k")

    ;; The substituted VALUE is non-ASCII too, so the splice path decodes and re-encodes it.
    (print "[{0}]" "日本語")

    ;; And a container argument, which renders through `display` rather than `+` concat.
    (print "{0} café" ["é" "😀"])
)

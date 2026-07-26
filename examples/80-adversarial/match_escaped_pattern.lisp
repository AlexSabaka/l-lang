;; An ESCAPE SEQUENCE in a match pattern -- the same literal, on both sides of the `=>`.
;;
;; `constantPattern` sliced the quotes off a pattern's string and stopped, where every other string in
;; the language is DECODED. So one spelling meant two things depending on which side of a match arm it
;; sat on:
;;
;;     (== s "\\")                 ->  true          one backslash, correctly decoded
;;     (match s { "\\" => … })     ->  never fired   two characters, compared against one
;;
;; Word for word the defect the string builder carries a comment about having fixed for ITSELF, in the
;; formatted-vs-plain split; the pattern path was never given the same treatment.
;;
;; It is invisible by inspection, which is what makes it worth a guard: the arm does not error, it
;; simply never matches, so the `match` falls to its catch-all and produces a plausible wrong answer.
;; A regex engine hits it immediately -- `\` is the one character such an engine must be able to match
;; on -- which is how it was found at all.
(
    (import "std/core/string")

    (let bs "\\")
    (let tab "\t")
    (let nl "\n")
    (let quote "\"")

    ;; The expression side was always right: one character, not two.
    (console.log "backslash length:" (strlen bs))

    ;; The pattern side now agrees with it.
    (console.log "backslash:" (match bs { "\\" => "matched" _ => "FELL THROUGH" }))
    (console.log "tab:"       (match tab { "\t" => "matched" _ => "FELL THROUGH" }))
    (console.log "newline:"   (match nl { "\n" => "matched" _ => "FELL THROUGH" }))
    (console.log "quote:"     (match quote { "\"" => "matched" _ => "FELL THROUGH" }))

    ;; And a pattern that should NOT match still does not -- the fix decodes, it does not blur.
    (console.log "not a tab:" (match bs { "\t" => "WRONGLY MATCHED" _ => "correctly fell through" }))

    ;; The two sides of the language agreeing is the actual property being pinned.
    (console.log "agrees with ==:" (== (match bs { "\\" => #t _ => #f }) (== bs "\\")))
)

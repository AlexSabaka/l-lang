;; Extension Methods -- a String toolkit
;;
;; This example demonstrates:
;; - :extension, a DISPATCH modifier (D34): it does not change the body, it makes
;;   a free function callable as a METHOD on its FIRST parameter (the receiver)
;; - the TWO surfaces of ONE definition: `(s.titlecase)` and `(s |> titlecase)`
;;   both call the same free function
;; - METHOD CHAINING: each extension returns a String, so the next one dispatches
;;   on the result -- `((s.reversewords).titlecase)`
;; - extensions calling extensions, built on top of std/string and std/seq
;; - mixing :extension fns with a plain helper: `capitalize` has no modifier, so
;;   it stays an ordinary function and is passed to `map` by name

(
    (import "std/io")
    (import "std/core/string")
    (import "std/seq")

    ;; --- The toolkit --------------------------------------------------------

    ;; words -- split on spaces, dropping the empties a double space leaves behind.
    ;; The receiver is the FIRST parameter: `(s.words)` dispatches here with s = the
    ;; string on the left of the dot.
    (fn :extension words [s <- String] -> String[]
        (filter (fn [w] (> (strlen w) 0)) (split (trim s) " ")))

    ;; wordcount -- an extension whose body calls another extension on its receiver.
    (fn :extension wordcount [s <- String] -> Int
        (length (s.words)))

    ;; capitalize -- a plain helper (no :extension): first letter up, rest down.
    ;; Without the modifier there is no `.capitalize`; it is called the normal way.
    (fn capitalize [w <- String] -> String
        (+ (upcase (substr w 0 1)) (downcase (substr w 1 (strlen w)))))

    ;; titlecase -- Every Word Capitalized.
    (fn :extension titlecase [s <- String] -> String
        (join (map capitalize (s.words)) " "))

    ;; reversewords -- "a b c" -> "c b a"
    (fn :extension reversewords [s <- String] -> String
        (join (reverse (s.words)) " "))

    ;; shout -- trimmed, upper, banged. It trims but does not re-split, so an
    ;; interior double space survives where `titlecase` would have eaten it.
    (fn :extension shout [s <- String] -> String
        (+ (upcase (trim s)) "!"))

    ;; --- Using them ---------------------------------------------------------

    ;; Deliberately ragged: padded at both ends, with a double space inside.
    (let phrase "  the  quick brown fox  ")

    (print "raw:        '{0}'" phrase)
    (print "words:      {0}" (join (phrase.words) "|"))
    (print "wordcount:  {0}" (phrase.wordcount))
    (print "titlecase:  {0}" (phrase.titlecase))
    (print "reversed:   {0}" (phrase.reversewords))
    (print "shout:      {0}" (phrase.shout))

    ;; The SAME definition through the pipe surface (D33): `(x |> f)` is `(f x)`.
    (print "pipe:       {0}" (phrase |> titlecase))

    ;; CHAINING -- `(phrase.reversewords)` is a String, so `.titlecase` dispatches
    ;; on it, and `.shout` on that.
    (print "chain:      {0}" ((phrase.reversewords).titlecase))
    (print "chain3:     {0}" (((phrase.reversewords).titlecase).shout))

    ;; The same chain, spelled flat with the pipe -- same functions, same result.
    (print "pipechain:  {0}" (phrase |> reversewords |> titlecase |> shout))
)

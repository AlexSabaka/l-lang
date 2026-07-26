;; NEGATIVE: an attribute argument that is not a literal -> LL0033 (D72).
;;
;; An attribute is DATA. Its arguments are carried in the reflection metadata table, which both
;; backends emit as data -- an `ll_map_of` of literals on C -- and never evaluate. That is exactly why
;; an annotation needs no evaluator and works on C today, where a decorator does not.
;;
;; So an argument that has to be RUN to be read cannot be an attribute's. Without this it was accepted
;; and then silently dropped from the graph, leaving the annotation present with its arguments missing
;; -- which reads as "this attribute takes no arguments" to anyone asking reflection.
;;
;; A DECORATOR's arguments are deliberately not restricted this way: they may be any expression, as
;; they always could, and only the literal ones are reflected.
(
  (defattribute note [text <- String])

  (fn :note[(+ "a" "b")] f [] -> Int (return 1))

  (console.log (f))
)

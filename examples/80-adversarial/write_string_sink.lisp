;; ADVERSARIAL (conformance guard): `write-string`, the i/o SINK (Fb, FLOOR.md §2).
;;
;; The floor has exactly one way out of the language to a stream: raw bytes, no newline, no join, no
;; formatting. `console.log` and `print` are LAYERS over it on both backends -- console.log joins its
;; displayed arguments with a space and appends the newline; print substitutes {N} first.
;;
;; Before this existed, a PARTIAL line was not expressible: every route out appended a newline. That
;; is what the first three lines below pin -- they must land on ONE line, in order, with no separator
;; the program did not write itself.
;;
;; The sink takes a String and nothing else. It does not display, so a value has to be rendered before
;; it gets here -- which is the layering made visible: formatting is above the floor, not in it.
(
    (import "std/io")

    (write-string "a")
    (write-string "b")
    (write-string "c")
    (write-string "\n")

    ;; No separator is inserted between calls; the program supplies its own.
    (write-string "1")
    (write-string ", ")
    (write-string "2")
    (write-string "\n")

    ;; console.log is the layer: space-joined, newline-terminated, values displayed.
    (console.log "layer:" [1 2 3])

    ;; ...and print is a layer over the same sink, with {N} substitution first.
    (print "print layer: {0} and {1}" "x" [4 5])
)

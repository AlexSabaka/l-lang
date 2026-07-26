;; `defattribute` -- D68's third role, D72.
;;
;; A `:name` is one of three things, and until now the language could only spell two of them. A
;; MODIFIER is a fact the compiler acts on (`:public`, `:ctor`); a DECORATOR is a transformer declared
;; with `defmodifier`, which wraps the declaration at run time. An ATTRIBUTE is neither: it is
;; annotation DATA, attached to a declaration and carried into the reflection graph, running nothing.
;;
;; Anything that was not a builtin used to be treated as a decorator by both backends, so an
;; annotation had to be smuggled in as one -- which is why a custom modifier on a class threw
;; `TypeError: Widget is not a constructor`, and why C refused the whole category with ELL0106.
;;
;; THE POINT OF THE SPLIT: an attribute is portable. It is a row in a metadata table the C backend
;; already emits, so it works on both backends today -- including on a CLASS, where a decorator still
;; cannot. The decorator is the genuinely hard part, and separating them means C stops rejecting both
;; for the sins of one.
(
    ;; A name and typed parameters. No body -- there is nothing to run, and the grammar says so rather
    ;; than accepting one and ignoring it.
    (defattribute docstring [text <- String])
    (defattribute author [name <- String])
    (defattribute deprecated [])

    ;; Applied with D68-a's adjacency-gated modifier arguments. No new syntax was needed for this:
    ;; `:name[args]` already parsed, it simply had no way to mean "data".
    (fn :docstring["adds two numbers"] :author["Sabaka"]
        add [a <- Int b <- Int] -> Int (+ a b))

    ;; ON A CLASS -- the case a decorator cannot do. `(defclass :traced W …)` compiles and then throws
    ;; at construction, because a `defmodifier` returns a plain arrow and `new` on an arrow throws.
    ;; An attribute wraps nothing, so there is nothing to go wrong.
    (defclass :docstring["a widget with a size"] Widget
        (let :ctor size <- Int))

    ;; A struct and an interface take them too -- it is one field on the shared declaration entry.
    (defstruct :docstring["a point in the plane"] Point
        (let :ctor x <- Int)
        (let :ctor y <- Int))

    ;; No arguments at all is fine: the presence of the annotation is the whole message.
    (fn :deprecated old-add [a <- Int b <- Int] -> Int (+ a b))

    ;; And none of it changes what the code DOES. An attribute emits nothing; these run exactly as
    ;; they would with the annotations deleted.
    (console.log "add:" (add 2 3))
    (console.log "deprecated:" (old-add 10 5))

    (let w (Widget 7))
    (console.log "class:" w.size)

    (let p (Point 3 4))
    (console.log "struct:" p.x p.y)
)

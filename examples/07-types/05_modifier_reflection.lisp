;; Reflecting on a declaration's MODIFIERS (D68).
;;
;; Every declaration kind that reaches the metadata graph now carries the modifiers written on it, as
;; `{name, kind}`. `kind` is D68's three roles by their own names: "builtin" for a fact the compiler
;; acts on (`:public`, `:ctor`, `:gen`), "decorator" for a `defmodifier` transformer, "attribute" for
;; `defattribute` annotation data. The compiler derives that from the same sources its emitters
;; consult, so a modifier cannot be described here as one thing and lowered as another.
;;
;; Before this, `std/llang/reflect` could report a type's members, methods, parameters, generics,
;; interfaces and ancestors -- and had no way to answer what was written directly in front of the
;; declaration.
;;
;; The "custom" arm is exercised in 06 rather than here, and that file is deliberately not C-pinned:
;; applying a `defmodifier` on C is ELL0106 today, so a custom modifier cannot be ATTACHED there at
;; all, never mind reflected on.
(
    (import "std/llang/reflect")

    (fn :public visible [] -> Int (return 3))
    (fn plain [] -> Int (return 1))

    (defclass :public Widget
        (let :ctor size <- Int))

    (defstruct :public Point
        (let :ctor x <- Int)
        (let :ctor y <- Int))

    ;; A function's own modifiers. Visibility reaches reflection on MEMBERS already, as
    ;; isPublic/isPrivate -- a top-level function had no such channel.
    (console.log "fn:" (modifier-names (type-by-name "visible")))

    ;; A declaration carrying none has no key at all, and answers the empty vector rather than
    ;; raising. Every accessor in this module is total in that way.
    (console.log "plain:" (modifier-names (type-by-name "plain")))

    ;; The same question of a class and of a struct -- one field on the shared entry, so every kind
    ;; that reaches the graph answers it.
    (console.log "class:" (modifier-names (type-by-name "Widget")))
    (console.log "struct:" (modifier-names (type-by-name "Point")))

    ;; Asking about one by name, rather than fetching the list.
    (console.log "has public:" (has-modifier (type-by-name "Widget") "public"))
    (console.log "has static:" (has-modifier (type-by-name "Widget") "static"))

    ;; And the decorator subset, which is empty here because every modifier above is a builtin.
    (console.log "decorators:" (decorators (type-by-name "Widget")))
)

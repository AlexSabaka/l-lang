;; The "custom" arm of D68's modifier reflection -- a `defmodifier`-declared decorator, reported as
;; distinct from a builtin.
;;
;; Split out of 05 and deliberately NOT C-pinned, for a reason worth stating plainly: applying a
;; custom modifier on C is `ELL0106 Cannot generate C for 'modifier:<name> on <fn>'`. The C backend
;; has no `defmodifier` lowering at all, so a decorator cannot be ATTACHED there, never mind
;; reflected on. That gap is D68's, and closing it is the trichotomy round's job -- an attribute is a
;; metadata row C already emits, a decorator needs closures over declarations.
;;
;; The reflection side is backend-neutral and would report this identically on C the moment the
;; decorator lowers, because both backends read the one graph.
(
    (import "std/llang/reflect")

    (defmodifier traced []
        (fn [original]
            (fn [...args] (original ...args))))

    (fn :traced work [] -> Int (return 7))
    (fn :public :traced both [] -> Int (return 9))

    ;; The name, alongside a builtin, in the order written.
    (console.log "all:" (modifier-names (type-by-name "both")))

    ;; And the decorator subset, which is what the split buys: a caller asking "what transforms this?"
    ;; gets the two apart without knowing the builtin list by heart.
    (console.log "custom:" (custom-modifiers (type-by-name "both")))
    (console.log "custom only:" (custom-modifiers (type-by-name "work")))

    (console.log "has traced:" (has-modifier (type-by-name "work") "traced"))
    (console.log "result:" (work))
)

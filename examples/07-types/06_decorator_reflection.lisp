;; The DECORATOR arm of D68's modifier reflection -- a `defmodifier`-declared transformer, reported as
;; distinct from a builtin and from an attribute, with its arguments.
;;
;; Split out of 05 and deliberately NOT C-pinned, for a reason worth stating plainly: applying a
;; decorator on C is `ELL0106 Cannot generate C for 'modifier:<name> on <fn>'`. The C backend has no
;; `defmodifier` lowering at all, so a decorator cannot be ATTACHED there, never mind reflected on.
;;
;; That gap is exactly what D72's split narrowed. An ATTRIBUTE works on C today (08, 09), because it is
;; a metadata row the backend already emits. A DECORATOR needs closures over declarations, and it is
;; now the only part of D68 that is still backend-specific.
;;
;; The reflection side is backend-neutral and would report this identically on C the moment the
;; decorator lowers, because both backends read the one graph.
(
    (import "std/llang/reflect")

    (defmodifier traced []
        (fn [original]
            (fn [...args] (original ...args))))

    (defmodifier retry [times <- Int]
        (fn [original]
            (fn [...args] (original ...args))))

    (fn :traced work [] -> Int (return 7))
    (fn :public :traced both [] -> Int (return 9))
    (fn :retry[4] flaky [] -> Int (return 11))

    ;; The name, alongside a builtin, in the order written.
    (console.log "all:" (modifier-names (type-by-name "both")))

    ;; And the decorator subset, which is what the split buys: a caller asking "what transforms this?"
    ;; gets the roles apart without knowing the builtin list by heart.
    (console.log "decorators:" (decorators (type-by-name "both")))
    (console.log "decorator only:" (decorators (type-by-name "work")))

    ;; A decorator's ARGUMENTS reflect too, for the same reason its name does -- it is part of the
    ;; declaration's description, and `:retry[4]` retries a specific number of times.
    (for :each m :from (modifiers (type-by-name "flaky")) :then (
        (console.log "entry:" m.name m.kind m.args)
    ))

    ;; A decorator is not an attribute, and reflection says so rather than lumping both under "not
    ;; builtin" the way the compiler itself used to.
    (console.log "not an attribute:" (has-attribute (type-by-name "work") "traced"))

    (console.log "result:" (work))
)

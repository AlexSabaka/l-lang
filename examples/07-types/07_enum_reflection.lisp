;; Enums become DESCRIBABLE (D70).
;;
;; An enum was the one declaration kind reflection could not see at all: `(type-by-name "Dir")`
;; answered nil while every class, struct, interface and function answered a descriptor. The cause was
;; that nothing in the types pass ever visited an enum, so no metadata was ever attached.
;;
;; What this does NOT change is how a member compiles. `Dir:up` is still folded to a constant below
;; the HIR -- no lookup, no allocation, nothing emitted at run time. The entry adds a description
;; alongside, which is the only thing there can BE: at run time an enum member is an Int, and nothing
;; anywhere recorded what it had been called.
(
    (import "std/llang/reflect")

    (defenum Dir :up :down :left :right)

    ;; Explicit values, and -- the case worth pinning -- an implicit member AFTER an explicit one.
    (defenum Status :ok => 200 :missing => 404 :teapot)

    (let d (type-by-name "Dir"))
    (let s (type-by-name "Status"))

    ;; The enum now has an entry at all, which is the whole of D70.
    (console.log "kind:" d.kind)
    (console.log "is-enum:" (is-enum d))
    (console.log "class is not:" (is-enum (type-by-name "Int")))

    (console.log "names:" (enum-member-names d))

    ;; With no explicit value, a member's value is its ordinal.
    (console.log "ordinal:" (enum-value d "left"))

    ;; With one, it is that.
    (console.log "explicit:" (enum-value s "missing"))

    ;; AND THE RULE THE TWO COULD DISAGREE ON. `:teapot` follows `:missing => 404`. l-lang gives it
    ;; its ORDINAL, 2 -- not 405, which is what C# and TypeScript would say. The metadata builder
    ;; states that rule separately from the two emitters (they produce nodes, it produces a value), so
    ;; this asserts they agree rather than trusting that they do.
    (console.log "after explicit:" (enum-value s "teapot"))
    (console.log "agrees with the fold:" (== Status:teapot (enum-value s "teapot")))
    (console.log "and for an explicit one:" (== Status:ok (enum-value s "ok")))

    ;; The reverse lookup, which could not be written at any price before the entry existed.
    (console.log "name of 404:" (enum-name-of s 404))
    ;; Asserted rather than printed: a bare "" would put a TRAILING SPACE in the golden, which is
    ;; invisible in review and stripped by half the editors that would ever touch this file.
    (console.log "name of 999 is empty:" (== "" (enum-name-of s 999)))

    ;; An unknown member is nil, not a raise -- total, like every accessor in this module.
    (console.log "unknown:" (enum-value d "sideways"))

    ;; And the member reference itself is unchanged: still a folded constant.
    (console.log "folded:" Status:missing Dir:right)
)

;; TWO QUESTIONS MUST NOT SHARE ONE NAME IN ONE PACKAGE.
;;
;; `std/llang/ast` and `std/llang/reflect` are package SIBLINGS, so importing either injects both.
;; They used to declare five names in common -- `is-class`, `is-struct`, `is-interface`,
;; `is-function`, `is-enum` -- asking DIFFERENT questions: ast's read an AST node's `_type`, reflect's
;; read a runtime type descriptor's `kind`. Measured before the fix, same descriptor, same call, no
;; diagnostic in any arrangement:
;;
;;     (import "std/llang/reflect")            -> (is-class d)  true
;;     (import "std/llang/ast")                -> (is-class d)  false
;;     ast then reflect                        -> false
;;     reflect then ast                        -> true
;;
;; The winner was module order. LL0240 exists to catch exactly this and does NOT fire for siblings,
;; because a sibling arrives by injection rather than by import -- recorded as an open question in
;; docs/roadmap.md, since making the diagnostic see them is a ruling, not a rename.
;;
;; The AST predicates carry `-node` now. This file pins that the two questions stay DISTINGUISHABLE:
;; each answers true for its own subject and false for the other's. If they are ever merged back into
;; one name, the two columns below become identical and this file fails.
(
    (import "std/llang/ast")
    (import "std/llang/reflect")

    (defclass Dog (let :ctor n <- Int))

    ;; A runtime TYPE DESCRIPTOR: reflect's question is yes, ast's is no.
    (let d (type-by-name "Dog"))
    (console.log "descriptor is-class:" (is-class d))
    (console.log "descriptor is-class-node:" (is-class-node d))

    ;; An AST NODE: ast's question is yes, reflect's is no.
    (let form '(+ 1 2))
    (console.log "form is-list-node:" (is-list-node form))
    (console.log "form is-class-node:" (is-class-node form))
    (console.log "form is-class:" (is-class form))
)

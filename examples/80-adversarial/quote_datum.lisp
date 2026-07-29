;; ADVERSARIAL: `'form` is CODE AS DATA, and the two backends must build the SAME datum (M1).
;;
;; The C backend had NO code generator for quote at all -- `ELL0106 special:quote, no lowering exists`
;; -- so the language's headline homoiconicity feature did not exist on the REFERENCE backend (D86),
;; only on the deprecated oracle. `12-quote-macros/00_quoting.lisp` is `xfail` and was never listed in
;; `c-status.ts`, so nothing measured the gap either.
;;
;; The contract is three lines long, and it is shared with `JSTransformerAstVisitor.dataToESTree` so
;; that one golden can grade both:
;;
;;   * an array becomes a VECTOR
;;   * an object becomes a MAP keyed by its own field names, MINUS `_location` and `_parent`
;;   * everything else is its literal
;;
;; `_parent` is dropped because it is cyclic -- emitting it would not terminate -- and `_location`
;; because it is compiler bookkeeping, not part of the form.
;;
;; D3d is why this is worth having: quote used to compile to `JSON.stringify(node)`, which is code as
;; TEXT, i.e. code as nothing. The map tree is WALKABLE, which is the whole difference.
;;
;; THIS FILE ASSERTS THE CONTRACT, NOT THE SERIALISATION. What a datum PRINTS as depends on the order
;; `AstBuilder.makeNode` happens to set fields in -- an implementation detail nobody ruled and nothing
;; should be pinned to. What IS ruled is that the form is reachable by name and by index, that its
;; `_type` is the node's own, and that its literals keep their kinds. Every expected line below is
;; derived from the source form.
;;
;; THE RETURN TRIP IS STILL MISSING. `(eval x)` is LL0236 on both backends and this file does not use
;; it. Quote is the representation half of homoiconicity; that is the half being pinned here.
(
    ;; -- the operand is NEVER evaluated ------------------------------------------------------------
    ;;
    ;; If quote evaluated its operand this would print 3. It is data: a `list` node.

    (let expr '(+ 1 2))
    (console.log "type:" expr._type)

    ;; -- and it is WALKABLE, which is the entire point ---------------------------------------------
    ;;
    ;; The head of `(+ 1 2)` is the identifier `+`. Reaching it by field and index is what separates
    ;; code-as-data from code-as-text.

    (let h (head expr.nodes))
    (console.log "head type:" h._type)
    (console.log "head id:" h.id)

    ;; -- every literal kind survives the trip, and Int stays Int -----------------------------------
    ;;
    ;; D51 splits Int from Real, and the datum keeps the split: a lowering that made every number a
    ;; double would report `float-number` for the 1 below and diverge from the oracle.

    ;; Each step is BOUND rather than chained off a call: `(head ns)._type` is not a spelling the
    ;; grammar accepts (a member off a call RESULT), which is D1's territory and nothing to do with
    ;; quote. Binding keeps this file about the datum.
    (let lits '(1 2.5 "s" true nil))
    (let ns lits.nodes)
    (let n0 (head ns))
    (console.log "int type:" n0._type)
    (console.log "int value:" n0.value)
    (console.log "real type:" ns[1]._type)
    (console.log "string type:" ns[2]._type)
    (console.log "bool type:" ns[3]._type)

    ;; -- it NESTS, which is where a non-recursive lowering would stop ------------------------------
    ;;
    ;; `'(f (> x 10) "big")` holds a nested comparison at index 1. Reaching THAT list's own head
    ;; proves the recursion rather than assuming it.

    (let nested '(f (> x 10) "big"))
    (let second nested.nodes[1])
    (let inner (head second.nodes))
    (console.log "nested type:" second._type)
    (console.log "inner op:" inner.id)

    ;; -- an IDENTIFIER is data, not a lookup -------------------------------------------------------
    ;;
    ;; `undefined-name-xyz` is defined nowhere in this program. Quoting it must neither resolve it nor
    ;; refuse it: a name is a datum.

    (let u '(undefined-name-xyz 1))
    (let uh (head u.nodes))
    (console.log "unbound:" uh.id)
    (console.log "done")
)

;; CONFORMANCE guard: `:as` binds, on BOTH sides of the boundary, on BOTH backends.
;;
;; The grammar has had `:as` on imports and exports since the frontend was written. Neither did
;; anything, and the two failed differently, which is the interesting part:
;;
;;   (import { f :as g } from "m")   the alias was DROPPED -- `importedNames` read `.symbol` and never
;;                                   `.as`. So `g` was undefined AND `f` stayed bound: you renamed a
;;                                   thing, the new name did not exist, and the old one still worked.
;;   (export f :as g)                the alias was STORED and never read -- `exportName` has exactly
;;                                   one consumer and it is `!== undefined`, a boolean. The module
;;                                   went on offering `f`.
;;
;; Zero uses in lib/ or examples/, so the whole feature had never once run.
;;
;; WHY THERE WAS NOWHERE TO PUT IT. Cross-module resolution is a flat union over module ROOT SCOPES,
;; keyed by the name each symbol was DECLARED with, and the import list acted purely as a filter over
;; that union (LL0216). A filter cannot rename. There was no binding site, which is why the field
;; parsed into an AST that nothing could act on.
;;
;; The fix is that binding site: an import now writes the local name into the IMPORTING module's own
;; top-level scope, pointing at the existing entry. It shares the entry rather than copying it, and
;; that is what makes the rename free downstream -- codegen resolves an identifier to a `SymbolEntry`
;; and derives the emitted name from THAT (the JS inliner keys on `source::declaredName`), so an
;; aliased reference emits the same inlined binding as an unaliased one. Neither backend was touched.
;;
;; A rename REPLACES; it does not add. `(import { plain-name :as aliased })` leaves `plain-name`
;; unbound in this file -- LL0216 -- and `(export internal-name :as renamed-by-export)` means the
;; module no longer offers `internal-name` at all -- LL0235. Both negatives are pinned in
;; 90-diagnostics/ll0235_import_name_not_found/ and in the type-errors suite; what this file measures
;; is that the POSITIVE half genuinely runs, and runs the same on C.
(
    (import { plain-name :as aliased } from "provider.lisp")
    (import { renamed-by-export } from "provider.lisp")
    (import { Widget :as Gadget } from "provider.lisp")

    ;; 1. An import alias binds the new name.
    (console.log "import alias: " (aliased))

    ;; 2. An export alias is the name the module OFFERS; the consumer imports that, unaliased.
    (console.log "export alias: " (renamed-by-export))

    ;; 3. Both at once, on a class: exported as `Widget`, imported as `Gadget`. The alias binds the
    ;;    symbol, so construction and method dispatch both follow it.
    (let g (Gadget))
    (console.log "class alias:  " (g.describe))
)

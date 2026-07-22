;; NEGATIVE: an import list naming something the module does not offer -> LL0235.
;;
;; The missing half of the module boundary. Three questions can be asked about a cross-module name,
;; and only two of them were:
;;
;;   LL0215  does that module EXPORT it?          asked, from the use site
;;   LL0216  did this file ASK for it?            asked, from the use site
;;   LL0235  does the module HAVE it at all?      never asked, of the import list itself
;;
;; Both of the first two are driven from a USE, so the import list was checked against nothing. A
;; misspelled import produced no diagnostic at the import; at best it produced an LL0210 at each use,
;; naming the use rather than the typo, and a name imported but never used reported nothing at all.
;;
;; That is how this was found. A program imported `{ should-error-here }` from a module that has no
;; such name, then used a DIFFERENT binding it had never asked for, and compiled clean -- because the
;; only reference to the unasked-for name sat inside a string interpolation, which the checker did
;; not descend into either (see 80-adversarial/interp_is_an_expression.lisp). Two independent holes,
;; and the program fell through both.
;;
;; The two arms are separate messages because the FIX is different: a name that is not there is a
;; spelling problem in THIS file, while a name that is there but unexported is a change to the OTHER
;; module. Saying "cannot import" for both would name neither.
(
    ;; Arm 1 -- no such name in that module at all.
    (import { no-such-name } from "provider.lisp")

    ;; Arm 2 -- the name exists there, but the module does not export it.
    (import { withheld } from "provider.lisp")

    ;; The control: this one is spelled right AND exported, and must not be reported.
    (import { offered } from "provider.lisp")

    (console.log (offered))
)

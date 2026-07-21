;; ADVERSARIAL (regression guard): two imported modules whose MODULE-PRIVATE names collide.
;;
;; alpha.lisp and beta.lisp each define a private `TAG` constant and a private `decorate` function.
;; Under D20 those are four distinct bindings; only `alpha-label` and `beta-label` are exported. The
;; JS backend is module-aware -- `ensureSymbolInlined` memoizes on `${source}::${name}` -- so it
;; keeps them apart for free.
;;
;; The C backend flattens every lowered import into one global namespace keyed by the BARE source
;; name: `importedValues` / `importedLowered` dedup on the name alone, and `mangleC` carries no
;; module qualifier. So the second module's `TAG` and `decorate` were silently discarded and its
;; functions read the FIRST module's -- printing `[from alpha]` twice. Not a crash: a wrong answer,
;; which is the class the whole floor effort exists to eliminate.
;;
;; Both lines must differ in BOTH the value (`alpha`/`beta`) and the shape (`[...]`/`<...>`), so a
;; regression in the constant half or the function half is individually visible.
(
    (import "./alpha.lisp")
    (import "./beta.lisp")

    (console.log (alpha-label))
    (console.log (beta-label))
)

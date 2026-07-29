;; A three-module program, and the boundaries between them.
;;
;;   geometry/   a PACKAGE (package.yaml) -- shapes.lisp holds the types,
;;               measure.lisp the measurements over them
;;   format.lisp a plain FILE module owning presentation
;;   main.lisp   this file, the orchestrator, which owns neither
;;
;; The point is the seams. Every module's `(export ...)` list is its real public
;; surface (D20/LL0215) and `:private` is enforced inside a class (D11/LL0206),
;; so most of what these three files define is unreachable from right here.
;;
;; `geometry/package.yaml` names the package, and the package -- not the file -- is the
;; compilation unit (D35). Put its parent directory on the library search path and the
;; whole package answers to its MANIFEST NAME in one import:
;;
;;     llc run main.lisp -I .     with  (import "geometry")
;;
;; which brings in the union of BOTH files' exports -- `Rect` from shapes.lisp and
;; `area-of` from measure.lisp -- through that single name. Below it is imported by
;; PATH instead, so this example runs with no extra flags.
(
    (import "geometry/shapes.lisp")
    (import "geometry/measure.lisp")
    (import "format.lisp")

    (let rects [(new Rect 3 4) (new Rect 10 2) (new Rect 6 8)])
    (let disc (new Circle 2))

    (console.log (banner "geometry report"))

    (for :each r :from rects :then (
        (console.log (row (r.kind) f"{(r.w)}x{(r.h)}" (area-of r) (diagonal r)))))

    ;; A circle has no diagonal; the column is still drawn so the table lines up.
    (console.log (row (disc.kind) f"r={(disc.r)}" (area-of disc) 0))

    (console.log (total-line (total-area rects)))

    ;; Neither of these compiles, and that is the feature being shown:
    ;;   (round2 1.234)   LL0215 -- measure.lisp defines round2 but does not export it
    ;;   (pad-right "x" 4) LL0215 -- likewise format.lisp
    ;;   disc.tag         LL0206 -- `:private` is enforced, not a naming convention
)

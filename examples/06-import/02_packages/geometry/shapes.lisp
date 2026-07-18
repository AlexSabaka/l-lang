;; geometry/shapes.lisp -- the shape TYPES.
;;
;; One file of the `geometry` package (see package.yaml). A package is the compilation
;; unit (D35), so this file and measure.lisp are one unit with two names to the outside.
(
    ;; `:private` is not decorative -- it is ENFORCED (LL0206) and erased at emit.
    ;; `tag` is Rect's own business: `kind` is the way to ask.
    (defclass Rect
        (let :ctor w <- Int)
        (let :ctor h <- Int)
        (let :private tag <- String "rect")

        (fn kind [] -> String (return this.tag))
        (fn area [] -> Int (return (* this.w this.h))))

    (defclass Circle
        (let :ctor r <- Int)
        (let :private tag <- String "circle")

        (fn kind [] -> String (return this.tag))
        (fn area [] -> Real (return (* 3.141592653589793 (* this.r this.r)))))

    ;; The export list IS the public surface (D20/LL0215).
    (export Rect Circle)
)

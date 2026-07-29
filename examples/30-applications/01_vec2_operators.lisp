;; ============================================================
;; 01_vec2_operators.lisp -- a 2D integer vector, Vec2.
;; ============================================================
;; Extracted from the `dungeon` game (dungeon/vec.lisp).
;;
;; A value type (defstruct) with member operator overloads and an
;; :extension method:
;;   - `:operator +`   builds a fresh Vec2 (a struct operator may not
;;                     mutate `this`, LL0207, and needn't).
;;   - `:operator ==`  structural equality on the two fields.
;;   - `:extension manhattan` -- a free fn callable as a method on its
;;                     first Vec2 parameter; dispatch is compile-time
;;                     nominal, and Vec2 is concrete, so it resolves.
;; ============================================================
(
    (defstruct Vec2
        (let :ctor x <- Int 0)
        (let :ctor y <- Int 0)

        ;; `this` is the left operand, `o` the right. Returns a fresh Vec2.
        (fn :operator + [o <- Vec2] -> Vec2
            (return (Vec2 (+ this.x o.x) (+ this.y o.y))))

        (fn :operator == [o <- Vec2] -> Boolean
            (return (&& (== this.x o.x) (== this.y o.y))))

        (fn show [] -> String (return f"({(this.x)},{(this.y)})")))

    ;; An :extension over the nominal struct type.
    (fn :extension manhattan [self <- Vec2 o <- Vec2] -> Int
        (return (+ (abs-int (- self.x o.x)) (abs-int (- self.y o.y)))))

    (fn abs-int [n <- Int] -> Int
        (if (< n 0) (return (- 0 n)))
        (return n))

    (let a (Vec2 1 2))
    (let b (Vec2 3 4))
    (let sum (+ a b))

    (console.log f"a       = {(a.show)}")
    (console.log f"b       = {(b.show)}")
    (console.log f"a + b   = {(sum.show)}")

    ;; Overloaded == is structural, not reference identity.
    (console.log f"a == a       = {(== a a)}")
    (console.log f"a == b       = {(== a b)}")
    (console.log f"a+b == (4,6) = {(== sum (Vec2 4 6))}")

    ;; manhattan is called as a method on its first argument.
    (console.log f"manhattan(a, a+b) = {(a.manhattan sum)}")
    (console.log f"manhattan(a, b)   = {(a.manhattan b)}")
)

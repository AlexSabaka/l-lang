;; symbolic/expr -- the expression tree, exercised end to end.
;;
;; Builds p(x) = x^2 + 3x + 5 as data, then reads its shape (depth, size, free
;; variables), rewrites it by substitution, evaluates it numerically, and renders
;; it back to infix. Every printed number is DERIVED FROM MATHEMATICS in the
;; golden, never pasted from output: exact integers where the algebra is exact,
;; and a local fixed-decimal formatter (integer arithmetic only, so the two libm
;; float->string paths cannot make the two backends disagree) for the two
;; transcendental values.
(
    ;; The specific module file, not the package name: `std/math/symbolic` will later resolve to the
    ;; `symbolic.lisp` entry, whose narrow public surface would not re-export these constructors.
    (import "std/math/symbolic/expr")

    ;; Fixed-decimal render built from integral Reals (which print with no ".0"
    ;; identically on both backends). This is what keeps e and sqrt(2) stable in
    ;; the golden despite the backends' last-ULP libm differences -- the whole
    ;; reason std/math mandates a fmt-fixed rather than printing a raw Real.
    (fn pow10 [d <- Int] -> Real
        (mut r <- Real 1.0)
        (mut i <- Int 0)
        (while (< i d) ((r := (* r 10.0)) (i := (+ i 1))))
        (return r))
    ;; Join names with single-space separators, no trailing space -- a trailing
    ;; space in a golden is fragile (whitespace-trimming tools would break it).
    (fn join-sp [xs <- String[]] -> String
        (mut out "")
        (mut i <- Int 0)
        (while (< i xs.length) (
            (if (> i 0) (out := (+ out " ")))
            (out := (+ out xs[i]))
            (i := (+ i 1))
        ))
        (return out))

    (fn fixed [x <- Real d <- Int] -> String
        (let neg (< x 0.0))
        (let ax (if neg (- 0.0 x) x))
        (let scale (pow10 d))
        (let scaled (Math.round (* ax scale)))
        (let ip (Math.floor (/ scaled scale)))
        (mut fs (+ "" (- scaled (* ip scale))))
        (while (< fs.length d) ((fs := (+ "0" fs))))
        (return f"{(if neg "-" "")}{(ip)}.{(fs)}"))

    ;; p(x) = x^2 + 3x + 5
    (let x (var "x"))
    (let p (add (add (pow x (inum 2)) (mul (inum 3) x)) (inum 5)))

    (console.log "-- structure --")
    (console.log (+ "p            = " (to-string p)))
    (console.log f"depth        = {(depth p)}")
    (console.log f"size         = {(size p)}")
    (console.log (+ "free-vars    = " (join-sp (free-vars p))))

    (console.log "-- predicates --")
    (console.log f"is-sum p           = {(is-sum p)}")
    (console.log f"is-product (3*x)   = {(is-product (mul (inum 3) x))}")
    (console.log f"is-power (x^2)     = {(is-power (pow x (inum 2)))}")
    (console.log f"is-integer 5       = {(is-integer (inum 5))}")
    (console.log f"is-symbol x        = {(is-symbol x)}")

    (console.log "-- structural equality --")
    (console.log f"equal p p          = {(equal p p)}")
    (console.log f"equal x^2 x^3      = {(equal (pow x (inum 2)) (pow x (inum 3)))}")

    ;; q(y) = p(y+1): substituting x := (y+1) must satisfy q(1) = p(2).
    (let q (subst p "x" (add (var "y") (inum 1))))
    (console.log "-- substitution x := (y+1) --")
    (console.log (+ "q            = " (to-string q)))
    (console.log (+ "free-vars q  = " (join-sp (free-vars q))))

    (console.log "-- evaluation --")
    (let at2 (make-env))
    (at2.set "x" 2.0)
    (let at0 (make-env))
    (at0.set "x" 0.0)
    (let ye1 (make-env))
    (ye1.set "y" 1.0)
    (let empty (make-env))
    (console.log f"p(2)               = {(eval p at2)}")
    (console.log f"p(0)               = {(eval p at0)}")
    (console.log f"q(1) [= p(2)]      = {(eval q ye1)}")
    (console.log f"eval 2^10          = {(eval (pow (inum 2) (inum 10)) empty)}")
    (console.log f"eval sin(0)        = {(eval (sin (rnum 0.0)) empty)}")
    (console.log f"eval cos(0)        = {(eval (cos (rnum 0.0)) empty)}")
    (console.log f"eval log(1)        = {(eval (log (rnum 1.0)) empty)}")
    (console.log f"eval exp(1) (6dp)  = {(fixed (eval (exp (rnum 1.0)) empty) 6)}")
    (console.log f"eval 2^0.5 (6dp)   = {(fixed (eval (pow (inum 2) (rnum 0.5)) empty) 6)}")

    ;; general application: a named function the fixed operator set does not have.
    (let h (apply "hypot" [x (inum 3)]))
    (console.log "-- general call --")
    (console.log (+ "h            = " (to-string h)))
    (console.log f"is-call h          = {(is-call h)}")
    (console.log f"size h             = {(size h)}")
)

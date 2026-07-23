;; std/math/symbolic/expr -- the expression tree the symbolic package is built on.
;;
;; Everything downstream (diff, simplify, eval, to-string) is written AGAINST this shape, so the
;; shape is the whole decision. It is fixed here and nothing above it re-decides it.
;;
;; -----------------------------------------------------------------------------------------------
;; ONE TAGGED NODE, NOT A CLASS HIERARCHY. This is the representation, and it was chosen against two
;; real alternatives.
;;
;; A node is a single `Expr` carrying a `kind` tag (constant / var / unary / binary / call) plus a
;; string `sym` naming the operator or function, a `num` holding a constant's value, and an `args`
;; vector of child `Expr`. A leaf has no args; a unary node has one; a binary node has two; a call
;; has n. Dispatch is therefore two cheap reads -- `match e.kind`, then `match e.sym` -- and that is
;; exactly what makes differentiation and simplification writable as ONE RULE PER KIND in a single
;; file each, rather than smeared across a dozen types.
;;
;; REJECTED -- a subclass hierarchy (`Const`, `Var`, `Add`, `Mul`, ... `Call`, each a `defclass`),
;; the shape `examples/09-oop/03` uses for its evaluator. It reads beautifully for eval-by-dispatch
;; and nothing else. `add` and `mul` differ ONLY by a tag, so a class per operator is the same two
;; children duplicated N times; structural equality and substitution become double-dispatch instead
;; of a flat recursive walk; and every new rule in diff/simplify must either add a method to every
;; class or fan out a `match ... :of` across the whole tree. A CAS wants to pattern-match on data,
;; not send messages to it.
;;
;; REJECTED -- n-ary sums and products (`add` holding an arbitrary list of terms). It is what a
;; production CAS uses, because it makes like-term collection in `simplify` a single flattening pass.
;; But it makes the node shape variable where the differentiation rules want it fixed: the product
;; rule is stated on TWO factors, and an n-ary product forces a fold there for a convenience that
;; only `simplify` cashes in. The strictly-binary spine keeps every operator node a fixed 2-child
;; shape; `call` is the one genuinely variadic kind, and it is where any future n-ary form would be
;; grafted, so nothing here blocks it.
;;
;; -----------------------------------------------------------------------------------------------
;; THE TAGS ARE STRINGS, AND THAT IS FORCED, NOT STYLISTIC. The obvious `kind` is a `defenum`. It
;; does not survive import: MEASURED, an enum member referenced from an importing program lowers to
;; an identifier (`K3aB` on JS via a cross-module inlined copy, `u_K_3aB` on C) that is never emitted
;; into that program, so BOTH backends fail to even link -- and they fail on the imported module's
;; OWN functions, not just on code that names the enum. A module meant to be imported therefore
;; cannot define and use a `defenum` today. String-literal `match` patterns, by contrast, are
;; MEASURED to lower identically on both backends across the module boundary (JS `switch`, C string
;; compare). So `kind` is one of the five strings below and `sym` is the operator/function/variable
;; name, and every dispatch downstream -- in a foreign package or a sibling file -- is a plain string
;; match that a bug report can quote and a `grep` can find.
;;
;;   kind = "const" | "var" | "unary" | "binary" | "call"
;;   sym  (unary)  = "neg" | "sin" | "cos" | "exp" | "log"
;;   sym  (binary) = "add" | "sub" | "mul" | "div" | "pow"
;;   sym  (call)   = an arbitrary function name;   sym (var) = the variable name;  sym (const) = ""
;;
;; -----------------------------------------------------------------------------------------------
;; CONSTANTS ARE REAL, AND INTEGER-NESS IS A PREDICATE, NOT A SECOND FIELD. `num` is a plain `Real`.
;; A stored `Int | Real` constant was rejected on measurement, not taste: a union numeric field is
;; the D49d integer-division trap waiting to happen -- `(/ a b)` on two integer-valued constants
;; would be integer division and `x/2` at `x=1` would fold to `0`, a silent wrong answer of exactly
;; the class the two-backend invariant exists to kill. So a constant is a `Real`, `eval` returns a
;; `Real`, and "is this an integer" is `is-integer`, a test on the value. Small integers are exact in
;; a double, so `is-zero`/`is-one` -- the ones `simplify` leans on -- are exact.
;; Rational constants are deliberately absent: they would need `std/math`'s `Rational`, and this
;; module's dependency set is empty by design (it is the foundation of the subpackage). A rational
;; layer belongs one level up, once `expr` may import the value types.
;;
;; -----------------------------------------------------------------------------------------------
;; NODES ARE IMMUTABLE BY CONSTRUCTION. Fields are `let :ctor`, so a node cannot be mutated after it
;; is built; every operation that "changes" a tree (`subst`) builds a new one. That is what makes
;; structural sharing safe: `(mul x x)` may point both children at one object with no aliasing hazard,
;; because nothing ever writes through a node.
;;
;; Compiler gaps hit and worked around (see the report): `defenum` does not survive import (above);
;; `cast<T>` is unimplemented (`ELL0210 'cast' is not defined`), so Int->Real goes through `(+ 0.0 v)`;
;; `(call f args)` does not spread, so a catamorphic fold with a per-kind combiner is not expressible
;; -- the traversal `subexprs` (a preorder node list, no callback) stands in for it and is what
;; `free-vars` is built on.
(
    ;; NaN as a value, built locally rather than assumed ambient, so the module imports nothing.
    ;; It is the "not a number" answer `eval` gives for an unbound variable or an unknown function --
    ;; never printed by anything here (its spelling differs across backends: "NaN" vs "nan").
    (let NAN (/ 0.0 0.0))

    ;; The node. `sym` is the variable name (VAR), the operator name (UNARY/BINARY), or the function
    ;; name (CALL); "" for a constant. `num` is the value for a constant; 0.0 and unread otherwise.
    ;; `args` are the children: [] leaf, [x] unary, [a b] binary, [a b ...] call. A self-referential
    ;; `Expr[]` constructor parameter is legal and measured byte-identical on both backends.
    (defclass Expr
        (let :ctor kind <- String)
        (let :ctor sym <- String)
        (let :ctor num <- Real)
        (let :ctor args <- Expr[]))

    ;; -- constructors, one per node kind ---------------------------------------------------------
    ;;
    ;; These are the ONLY sanctioned way to build a node -- callers never touch the raw `Expr` ctor,
    ;; so the tag/arity invariant (a "binary" has exactly two args, etc.) holds by construction.

    ;; A real constant.
    (fn rnum [v <- Real] -> Expr (return (Expr "const" "" v [])))

    ;; An integer constant. Stored as a Real (see the header on why there is no Int field); `(+ 0.0 v)`
    ;; is the Int->Real promotion because `cast<Real>` is not implemented in the compiler today.
    (fn inum [v <- Int] -> Expr (return (Expr "const" "" (+ 0.0 v) [])))

    ;; A variable / symbol.
    (fn var [name <- String] -> Expr (return (Expr "var" name 0.0 [])))

    ;; Unary nodes. `neg` is unary minus; the four functions are the elementary ones diff needs.
    (fn neg [a <- Expr] -> Expr (return (Expr "unary" "neg" 0.0 [a])))
    (fn sin [a <- Expr] -> Expr (return (Expr "unary" "sin" 0.0 [a])))
    (fn cos [a <- Expr] -> Expr (return (Expr "unary" "cos" 0.0 [a])))
    (fn exp [a <- Expr] -> Expr (return (Expr "unary" "exp" 0.0 [a])))
    (fn log [a <- Expr] -> Expr (return (Expr "unary" "log" 0.0 [a])))

    ;; Binary nodes. Five operators, strictly two children each.
    (fn add [a <- Expr b <- Expr] -> Expr (return (Expr "binary" "add" 0.0 [a b])))
    (fn sub [a <- Expr b <- Expr] -> Expr (return (Expr "binary" "sub" 0.0 [a b])))
    (fn mul [a <- Expr b <- Expr] -> Expr (return (Expr "binary" "mul" 0.0 [a b])))
    (fn div [a <- Expr b <- Expr] -> Expr (return (Expr "binary" "div" 0.0 [a b])))
    (fn pow [a <- Expr b <- Expr] -> Expr (return (Expr "binary" "pow" 0.0 [a b])))

    ;; A general function application: `name` applied to n argument expressions. This is the one
    ;; variadic kind, and the escape hatch for any function the fixed unary/binary set does not name.
    (fn apply [name <- String args <- Expr[]] -> Expr (return (Expr "call" name 0.0 args)))

    ;; -- accessors -------------------------------------------------------------------------------
    ;;
    ;; Fields are public (`.kind .sym .num .args`); these name the common reads so diff/simplify read
    ;; as the algebra they are rather than as vector indexing.

    (fn arg-count [e <- Expr] -> Int (return e.args.length))
    (fn arg [e <- Expr i <- Int] -> Expr (return e.args[i]))
    (fn operand [e <- Expr] -> Expr (return e.args[0]))   ; the child of a unary node
    (fn left [e <- Expr] -> Expr (return e.args[0]))       ; first child of a binary node
    (fn right [e <- Expr] -> Expr (return e.args[1]))      ; second child of a binary node

    ;; -- predicates ------------------------------------------------------------------------------
    ;;
    ;; Kind-level first, then operator-level. The operator-level ones (`is-sum` etc.) are the vocabulary
    ;; the rewrite rules actually speak in.

    (fn is-const [e <- Expr] -> Boolean (return (== e.kind "const")))
    (fn is-number [e <- Expr] -> Boolean (return (== e.kind "const")))  ; alias, reads better in math prose
    (fn is-symbol [e <- Expr] -> Boolean (return (== e.kind "var")))
    (fn is-unary [e <- Expr] -> Boolean (return (== e.kind "unary")))
    (fn is-binary [e <- Expr] -> Boolean (return (== e.kind "binary")))
    (fn is-call [e <- Expr] -> Boolean (return (== e.kind "call")))

    (fn is-sum [e <- Expr] -> Boolean (return (&& (is-binary e) (== e.sym "add"))))
    (fn is-difference [e <- Expr] -> Boolean (return (&& (is-binary e) (== e.sym "sub"))))
    (fn is-product [e <- Expr] -> Boolean (return (&& (is-binary e) (== e.sym "mul"))))
    (fn is-quotient [e <- Expr] -> Boolean (return (&& (is-binary e) (== e.sym "div"))))
    (fn is-power [e <- Expr] -> Boolean (return (&& (is-binary e) (== e.sym "pow"))))
    (fn is-neg [e <- Expr] -> Boolean (return (&& (is-unary e) (== e.sym "neg"))))

    ;; Value tests on a constant. `is-integer` is what honours the "Int as well as Real" requirement
    ;; without a second field; `is-zero`/`is-one` are exact and are simplify's identity detectors.
    (fn is-integer [e <- Expr] -> Boolean (return (&& (is-const e) (== e.num (Math.floor e.num)))))
    (fn is-zero [e <- Expr] -> Boolean (return (&& (is-const e) (== e.num 0.0))))
    (fn is-one [e <- Expr] -> Boolean (return (&& (is-const e) (== e.num 1.0))))

    ;; -- structural equality ---------------------------------------------------------------------
    ;;
    ;; Exact and structural: same kind, same operator/name, same constant bits, same children in
    ;; order. NOT tolerant -- `(near a b tol)` is a different question and belongs to a numeric layer,
    ;; not to tree identity. The `num` compare is exact `==`, which is right here: two constants are
    ;; the same node iff they hold the same value, and small integers/short literals are exact doubles.
    (fn equal [a <- Expr b <- Expr] -> Boolean
        (if (!= a.kind b.kind) (return #f))
        (if (!= a.sym b.sym) (return #f))
        (if (!= a.num b.num) (return #f))
        (if (!= a.args.length b.args.length) (return #f))
        (mut i <- Int 0)
        (while (< i a.args.length) (
            (if (== (equal a.args[i] b.args[i]) #f) (return #f))
            (i := (+ i 1))
        ))
        (return #t))

    ;; -- traversal -------------------------------------------------------------------------------
    ;;
    ;; Every subexpression, self first, then each child's subtree in order (PREORDER). This is the
    ;; traversal in place of a fold: a catamorphism would want to hand a combiner the node plus its
    ;; already-folded children, and `(call f args)` cannot spread those arguments, so a general fold is
    ;; not expressible today. A flat node list is, and it is what the whole-tree queries below reduce
    ;; over -- which is all a PoC needs from a fold anyway.
    (fn subexprs [e <- Expr] -> Expr[]
        (mut out <- Expr[] [])
        (out.push e)
        (for :each c :from e.args :then (
            (for :each s :from (subexprs c) :then ((out.push s)))
        ))
        (return out))

    ;; -- free variables --------------------------------------------------------------------------
    ;;
    ;; The distinct variable names, in first-encounter (preorder) order -- deterministic, so a golden
    ;; over it is stable. There are no binders in this grammar, so "free" is simply "every variable";
    ;; the name is chosen for the reader who will add a `let`/lambda node later, at which point this
    ;; becomes the honestly-free set and the dedup logic is already here.
    (fn free-vars [e <- Expr] -> String[]
        (mut out <- String[] [])
        (for :each s :from (subexprs e) :then (
            (if (== s.kind "var") (
                (if (== (out.includes s.sym) #f) (out.push s.sym))
            ))
        ))
        (return out))

    ;; -- substitution ----------------------------------------------------------------------------
    ;;
    ;; Replace every variable named `name` with the expression `r`, rebuilding the spine above each
    ;; hit. Leaves are returned as-is (shared, which immutability makes safe); interior nodes are
    ;; rebuilt through the raw ctor because the kind/operator/value are preserved and only the
    ;; children change. This is the one operation the differentiator and simplifier both need in order
    ;; to specialise a general expression.
    (fn subst [e <- Expr name <- String r <- Expr] -> Expr
        (match e.kind {
            "var" => (if (== e.sym name) (return r) (return e))
            "const" => (return e)
            _ => (
                (mut newargs <- Expr[] [])
                (for :each c :from e.args :then ((newargs.push (subst c name r))))
                (return (Expr e.kind e.sym e.num newargs))
            )
        }))

    ;; -- shape metrics ---------------------------------------------------------------------------

    ;; Height of the tree; a leaf is 1.
    (fn depth [e <- Expr] -> Int
        (if (== e.args.length 0) (return 1))
        (mut m <- Int 0)
        (for :each c :from e.args :then (
            (let d (depth c))
            (if (> d m) (m := d))
        ))
        (return (+ 1 m)))

    ;; Total node count, self included.
    (fn size [e <- Expr] -> Int
        (mut n <- Int 1)
        (for :each c :from e.args :then ((n := (+ n (size c)))))
        (return n))

    ;; -- environment for evaluation --------------------------------------------------------------
    ;;
    ;; A variable->value binding, as two parallel vectors rather than a native map ON PURPOSE: a map
    ;; index of a missing key TRAPS, and a trap is catchable on JS but FATAL on C, so a partial
    ;; environment (the whole point of the "partially-numeric" case) would be a backend divergence
    ;; waiting to fire. Linear lookup with an explicit `has` cannot trap. A PoC binds a handful of
    ;; variables; the linear scan is not the thing to optimise.
    (defclass Env
        (mut names <- String[] [])
        (mut vals <- Real[] [])

        ;; Bind (or re-bind by appending; `get` returns the first match, so the earliest binding wins).
        (fn set [name <- String v <- Real] -> Void (
            (this.names.push name)
            (this.vals.push v)
        ))
        (fn has [name <- String] -> Boolean (
            (mut i <- Int 0)
            (while (< i this.names.length) (
                (if (== this.names[i] name) (return #t))
                (i := (+ i 1))
            ))
            (return #f)
        ))
        (fn get [name <- String] -> Real (
            (mut i <- Int 0)
            (while (< i this.names.length) (
                (if (== this.names[i] name) (return this.vals[i]))
                (i := (+ i 1))
            ))
            (return NAN)
        )))

    ;; A fresh empty environment. `(new Env)` also works; this is the spelling that reads as a value.
    (fn make-env [] -> Env (return (new Env)))

    ;; -- evaluation ------------------------------------------------------------------------------
    ;;
    ;; A numeric value under an environment. A fully-numeric expression needs no bindings (pass an
    ;; empty env); a partially-numeric one evaluates the numeric part and yields NaN through any
    ;; unbound variable or unknown function. NaN propagates, so a non-fully-numeric result is NaN
    ;; end-to-end -- an honest "this did not reduce to a number" rather than a wrong one.
    ;;
    ;; The two op tables are shared with the CALL kind: a one-argument call is dispatched as a unary,
    ;; a two-argument call as a binary, so `(apply "sin" [x])` evaluates exactly as `(sin x)` with no
    ;; second table to drift.

    (fn eval-unary [op <- String x <- Real] -> Real
        (match op {
            "neg" => (- 0.0 x)
            "sin" => (Math.sin x)
            "cos" => (Math.cos x)
            "exp" => (Math.exp x)
            "log" => (Math.log x)
            _ => NAN
        }))

    (fn eval-binary [op <- String a <- Real b <- Real] -> Real
        (match op {
            "add" => (+ a b)
            "sub" => (- a b)
            "mul" => (* a b)
            "div" => (/ a b)
            "pow" => (Math.pow a b)
            _ => NAN
        }))

    (fn eval [e <- Expr env <- Env] -> Real
        (match e.kind {
            "const" => (return e.num)
            "var" => (if (env.has e.sym) (return (env.get e.sym)) (return NAN))
            "unary" => (return (eval-unary e.sym (eval e.args[0] env)))
            "binary" => (return (eval-binary e.sym (eval e.args[0] env) (eval e.args[1] env)))
            "call" => (
                (let n e.args.length)
                (if (== n 1) (return (eval-unary e.sym (eval e.args[0] env))))
                (if (== n 2) (return (eval-binary e.sym (eval e.args[0] env) (eval e.args[1] env))))
                (return NAN)
            )
            _ => (return NAN)
        }))

    ;; -- rendering -------------------------------------------------------------------------------
    ;;
    ;; Fully parenthesised infix. No precedence handling ON PURPOSE: a fixed parenthesisation is
    ;; unambiguous and byte-deterministic across both backends, which a golden needs, and it never
    ;; misrepresents the tree's actual shape. A pretty-printer that drops redundant parens is a
    ;; separate, later concern. Constants print through `(+ "" num)`, which renders an integer-valued
    ;; Real with no trailing ".0" identically on both backends (measured).

    (fn binop-symbol [op <- String] -> String
        (match op {
            "add" => "+"
            "sub" => "-"
            "mul" => "*"
            "div" => "/"
            "pow" => "^"
            _ => "?"
        }))

    (fn to-string [e <- Expr] -> String
        (match e.kind {
            "const" => (return (+ "" e.num))
            "var" => (return e.sym)
            "unary" => (
                (let s (to-string e.args[0]))
                (if (== e.sym "neg") (return '"-({(s)})"))
                (return '"{(e.sym)}({(s)})")
            )
            "binary" => (
                (let a (to-string e.args[0]))
                (let b (to-string e.args[1]))
                (return '"({(a)} {(binop-symbol e.sym)} {(b)})")
            )
            "call" => (
                (mut out "")
                (mut i <- Int 0)
                (while (< i e.args.length) (
                    (if (> i 0) (out := (+ out ", ")))
                    (out := (+ out (to-string e.args[i])))
                    (i := (+ i 1))
                ))
                (return '"{(e.sym)}({(out)})")
            )
            _ => (return "?")
        }))

    (export
        Expr Env
        rnum inum var neg sin cos exp log add sub mul div pow apply
        arg-count arg operand left right
        is-const is-number is-symbol is-unary is-binary is-call
        is-sum is-difference is-product is-quotient is-power is-neg
        is-integer is-zero is-one
        equal subexprs free-vars subst depth size
        make-env eval to-string)
)

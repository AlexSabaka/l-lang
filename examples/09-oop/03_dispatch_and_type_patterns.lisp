;; Tree-Walking Interpreter — OOP Dispatch
;;
;; Where 10-algorithms/01_evaluator.lisp walks a *data* tree with `match`,
;; this one builds an object graph and lets dynamic dispatch do the walking.
;;
;; This example demonstrates:
;; - `definterface` + `:implements` as the contract every node satisfies
;; - a `defclass` hierarchy with `:extends` and overridden virtual methods
;; - recursion through `eval` on child nodes
;; - type patterns (`v :of Num`) to inspect a node without adding a method
;; - runtime type info via `(type x)["name"]`

(
    (import "std/io")

    ;; Every node can evaluate itself to a number and render itself
    ;; back to source text.
    (definterface Node
        (fn eval [] -> Real)
        (fn show [] -> String)
    )

    ;; A leaf: a literal number.
    (defclass Num :implements Node
        (let :ctor value <- Real)

        (fn eval [] -> Real (return this.value))
        (fn show [] -> String (return (+ "" this.value)))
    )

    ;; Shared base for the two-operand nodes. It owns the children and the
    ;; printing logic; subclasses supply only `symbol` and `eval`.
    (defclass BinOp :implements Node
        (let :ctor left <- Node)
        (let :ctor right <- Node)

        (fn symbol [] -> String (return "?"))
        (fn eval [] -> Real (return NaN))

        ;; `show` calls `symbol` virtually — the base never knows which
        ;; operator it is printing.
        (fn show [] -> String (
            (return (+ "(" (this.left.show) " " (this.symbol) " " (this.right.show) ")"))
        ))
    )

    (defclass Add :extends BinOp
        (fn symbol [] -> String (return "+"))
        (fn eval [] -> Real (return (+ (this.left.eval) (this.right.eval))))
    )

    (defclass Mul :extends BinOp
        (fn symbol [] -> String (return "*"))
        (fn eval [] -> Real (return (* (this.left.eval) (this.right.eval))))
    )

    ;; Type patterns ask what a node *is* at runtime, without adding a
    ;; `describe` method to every class in the hierarchy.
    (fn describe [n <- Node] -> String (
        (return (match n {
            v :of Num => (+ "literal " v.value)
            v :of Add => "addition"
            v :of Mul => "multiplication"
            _         => "unknown node"
        }))
    ))

    ;; `v :of BinOp` matches Add and Mul too — a type pattern tests the
    ;; whole subtree of the hierarchy, not just the exact class.
    (fn count-nodes [n <- Node] -> Int (
        (return (match n {
            v :of Num   => 1
            v :of BinOp => (+ 1 (count-nodes v.left) (count-nodes v.right))
            _           => 0
        }))
    ))

    (fn type-name [n <- Node] -> String (
        (let t (type n))
        (return t["name"])
    ))

    ;; Build ((2 + 3) * (4 + (5 * 6))) literally, then let the tree walk itself.
    (let tree (new Mul
        (new Add (new Num 2) (new Num 3))
        (new Add (new Num 4) (new Mul (new Num 5) (new Num 6)))))

    (print "source: {0}" (tree.show))
    (print "value:  {0}" (tree.eval))
    (print "nodes:  {0}" (count-nodes tree))

    (console.log "--- Node Introspection ---")
    (let samples [
        (new Num 7)
        (new Add (new Num 1) (new Num 2))
        (new Mul (new Num 3) (new Num 4))])

    (for :each n :from samples :then (
        (print "{0}: {1} => {2}" (type-name n) (describe n) (n.eval))
    ))
)

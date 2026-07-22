;; std/llang/reflect -- the typed surface over the D54 metadata graph.
;;
;; `type` and `type-by-name` are the floor; this module is the library over them. What it adds is the
;; three things a hand-written index gets wrong: TOTALITY (a descriptor's shape depends on its kind,
;; so `t["extends"]` throws on a root class), INHERITANCE (a subtype's metadata lists only its OWN
;; methods, so any `has-method` that does not walk is wrong for every override), and the fact that the
;; `extends` edge is a NAME, so climbing is a by-name lookup.

(import "std/llang/reflect")

(definterface Greeter
    (fn greet [] -> String))

(defclass Animal
    (mut :ctor name <- String)
    (mut :ctor legs <- Int)
    (fn speak [] -> String (return "..."))
    (fn describe [] -> String (return this.name)))

(defclass Dog :extends Animal :implements Greeter
    (fn speak [] -> String (return "woof"))
    (fn fetch [n <- Int] -> Int (return n))
    (fn greet [] -> String (return "hi")))

(fn add [a <- Int b <- Int] -> Int
    (return (+ a b)))

(
    ;; -- naming a VALUE, portably ----------------------------------------------------------------
    (console.log "--- values ---")
    (console.log "int:      " (name-of 7) (kind-of 7))
    (console.log "string:   " (name-of "hi") (kind-of "hi"))
    (console.log "array:    " (name-of [1 2 3]) (kind-of [1 2 3]))
    (console.log "map:      " (name-of {:a 1}) (kind-of {:a 1}))
    (console.log "nil:      " (name-of nil) (kind-of nil))
    (console.log "instance: " (name-of (Dog "rex" 4)) (kind-of (Dog "rex" 4)))
    (console.log "function: " (name-of add) (kind-of add))

    ;; -- a FUNCTION's shape ----------------------------------------------------------------------
    (console.log "--- function add ---")
    (let ft (type-by-name "add"))
    (console.log "is-function:" (is-function ft))
    (console.log "arity:      " (arity ft))
    (console.log "params:     " (param-names ft))
    (console.log "returns:    " (returns ft))

    ;; -- a CLASS's own shape ---------------------------------------------------------------------
    (console.log "--- class Dog ---")
    (let dt (type-by-name "Dog"))
    (console.log "is-class:   " (is-class dt))
    (console.log "own methods:" (method-names dt))
    (console.log "own props:  " (property-names dt))
    (console.log "implements: " (interfaces dt))
    (console.log "parent:     " (parent-name dt))
    (console.log "ancestors:  " (ancestors dt))

    ;; Dog declares no fields of its own -- `name` and `legs` are Animal's, and the graph does not
    ;; flatten them. That is why the walking accessors exist.
    (console.log "--- inherited ---")
    (console.log "all methods:" (all-method-names dt))
    (console.log "all props:  " (all-property-names dt))
    (console.log "has speak:  " (has-method dt "speak"))
    (console.log "has legs:   " (has-property dt "legs"))
    (console.log "has fly:    " (has-method dt "fly"))
    (console.log "subtype-of: " (is-subtype-of dt "Animal") (is-subtype-of dt "Greeter"))

    ;; An override resolves to the NEAREST declaration, and `speak` is declared on both.
    (let spoken (find-method dt "speak"))
    (console.log "speak ret:  " (returns spoken))
    (let fetched (find-method dt "fetch"))
    (console.log "fetch arity:" (arity fetched) (param-names fetched))

    ;; -- the ROOT, where every optional key is absent ---------------------------------------------
    (console.log "--- root Animal ---")
    (let at (type-by-name "Animal"))
    (console.log "parent:     " (parent-name at))
    (console.log "ancestors:  " (ancestors at))
    (console.log "ctor req:   " (required-count at))
    (console.log "parent obj: " (parent at))

    ;; -- totality: every accessor answers on a descriptor that has none of these keys --------------
    (console.log "--- a primitive ---")
    (let it (type-by-name "Int"))
    (console.log "kind:       " (type-kind it))
    (console.log "methods:    " (methods it))
    (console.log "params:     " (params it))
    (console.log "returns:    " (returns it))
    (console.log "ancestors:  " (ancestors it))
    (console.log "has-method: " (has-method it "anything")))

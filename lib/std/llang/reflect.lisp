;; std/llang/reflect -- the RTTI half of l-lang's self-description.
;;
;; `type` and `type-by-name` are the FLOOR (D54): the backend emits one metadata graph and both
;; runtimes read it. What they hand back is a raw map, and every caller in the corpus indexes it by
;; hand -- `my-pet-type["extends"]`, `t["name"]`, `shape-type["methods"]`. This module is the surface
;; over that, and it is a LIBRARY over an existing floor, not new machinery: nothing here is a
;; primitive, and none of it needed a backend change.
;;
;; -----------------------------------------------------------------------------------------------
;; WHY A SURFACE IS WORTH IT, given the graph is already readable.
;;
;; Three reasons, all of them things a hand-written index gets wrong:
;;
;; 1. TOTALITY. A descriptor's shape depends on its kind -- only a class carries `properties`, only a
;;    function carries `params`, only a SUBTYPE carries `extends`. So `t["extends"]` raises a D9
;;    KeyError on a root class, and `t["params"]` on anything that is not a function. Every accessor
;;    here answers nil or an empty vector instead, which is what makes composing them safe.
;;
;; 2. INHERITANCE IS NOT FLATTENED. `(type-by-name "Dog")` reports Dog's OWN methods; `speak`,
;;    declared on Animal, is not among them. That is the right shape for a graph -- it has an
;;    `extends` edge, and flattening would destroy the distinction -- but it means `has-method` is
;;    wrong for every subtype unless it walks. Both spellings exist here and are named for which they
;;    are: `methods` is declared, `all-methods` is inherited.
;;
;; 3. THE EDGE IS A NAME. `extends` holds a STRING, so climbing is a by-name lookup, not a pointer
;;    chase. Perfectly walkable, and nobody should have to know that to ask for a parent.
;;
;; -----------------------------------------------------------------------------------------------
;; TYPED `Any`, DELIBERATELY.
;;
;; A descriptor is a map, and the obvious move is to declare `definterface TypeInfo` over it and
;; type the whole module in terms of that. It would not work and it would not help: D42 conformance
;; is checked against DECLARED types, and a map literal minted by the runtime declares nothing, so
;; the annotation would be a claim the checker cannot verify -- an interface that is decoration.
;; `Any` is the honest spelling for a value whose shape is spec'd elsewhere (FLOOR.md D54) rather
;; than by the type system. The RETURNS are typed as tightly as the data allows -- `String`,
;; `String[]`, `Boolean`, `Int` -- so a caller reaching for a name or a count is in the type system
;; even when the descriptor is not.
(
    ;; -- naming a value --------------------------------------------------------------------------
    ;;
    ;; The portable pair. `lib/std/types` answers the same question with `x.constructor.name`,
    ;; `Array.isArray` and `typeof`, which is three host spellings and works on one backend; these
    ;; are one floor call and work on both.

    ;; The type NAME of a value: "Int", "String", "Array", "Map", "Nil", "Function", or a class name.
    (fn name-of [x <- Any] -> String
        (let t (type x))
        (return t.name))

    ;; The KIND of a value's type: "primitive", "container", "class", "struct", "interface",
    ;; "function", or "unknown" for a type the graph does not describe.
    (fn kind-of [x <- Any] -> String
        (let t (type x))
        (return t.kind))

    ;; -- asking a descriptor what it is ----------------------------------------------------------

    (fn type-name [t <- Any] -> String (return t.name))
    (fn type-kind [t <- Any] -> String (return t.kind))

    (fn is-class [t <- Any] -> Boolean (return (== t.kind "class")))
    (fn is-struct [t <- Any] -> Boolean (return (== t.kind "struct")))
    (fn is-interface [t <- Any] -> Boolean (return (== t.kind "interface")))
    (fn is-function [t <- Any] -> Boolean (return (== t.kind "function")))
    (fn is-primitive [t <- Any] -> Boolean (return (== t.kind "primitive")))
    (fn is-container [t <- Any] -> Boolean (return (== t.kind "container")))

    ;; -- the parts of a descriptor, TOTAL --------------------------------------------------------
    ;;
    ;; Each answers the empty vector where the raw index would throw. `t.properties` is the D9 total
    ;; accessor (the dotted read), so the nil test is the only thing standing between a caller and a
    ;; KeyError.

    (fn properties [t <- Any] -> Any[]
        (let ps t.properties)
        (if (== ps nil) (return []))
        (return ps))

    (fn methods [t <- Any] -> Any[]
        (let ms t.methods)
        (if (== ms nil) (return []))
        (return ms))

    ;; A function's parameters. A METHOD's parameters live on the method's own entry, not here.
    (fn params [t <- Any] -> Any[]
        (let ps t.params)
        (if (== ps nil) (return []))
        (return ps))

    ;; A function's declared return type, as a rendered type string. "" when it is not a function.
    (fn returns [t <- Any] -> String
        (let r t.returns)
        (if (== r nil) (return ""))
        (return r))

    ;; The constructor's parameters, or the empty vector. Note the two levels: `constructor` is a map
    ;; carrying `params` and `requiredCount`.
    (fn ctor-params [t <- Any] -> Any[]
        (let c t.constructor)
        (if (== c nil) (return []))
        (let ps c.params)
        (if (== ps nil) (return []))
        (return ps))

    ;; How many of the constructor's parameters have no default.
    (fn required-count [t <- Any] -> Int
        (let c t.constructor)
        (if (== c nil) (return 0))
        (let n c.requiredCount)
        (if (== n nil) (return 0))
        (return n))

    (fn generics [t <- Any] -> String[]
        (let g t.generics)
        (if (== g nil) (return []))
        (return g))

    (fn interfaces [t <- Any] -> String[]
        (let i t.implements)
        (if (== i nil) (return []))
        (return i))

    ;; How many parameters a function declares.
    (fn arity [t <- Any] -> Int
        (let ps (params t))
        (return ps.length))

    ;; -- names, for callers that want strings rather than descriptors ----------------------------

    (fn property-names [t <- Any] -> String[]
        (mut out <- String[] [])
        (for :each p :from (properties t) :then ((out.push p.name)))
        (return out))

    (fn method-names [t <- Any] -> String[]
        (mut out <- String[] [])
        (for :each m :from (methods t) :then ((out.push m.name)))
        (return out))

    (fn param-names [t <- Any] -> String[]
        (mut out <- String[] [])
        (for :each p :from (params t) :then ((out.push p.name)))
        (return out))

    ;; -- walking the graph -----------------------------------------------------------------------

    ;; The name of a type's parent, or "" if it has none. `extends` is absent on a root class, which
    ;; is why this exists rather than a raw index.
    (fn parent-name [t <- Any] -> String
        (let e t.extends)
        (if (== e nil) (return ""))
        (return e))

    ;; The parent's DESCRIPTOR, or nil at a root.
    (fn parent [t <- Any] -> Any
        (let e t.extends)
        (if (== e nil) (return nil))
        (return (type-by-name e)))

    ;; Every ancestor's name, nearest first. A root type answers the empty vector.
    ;;
    ;; The loop is bounded by a step count, not by trust. A metadata graph is built from declarations
    ;; and cannot legally contain a cycle -- but this walk is the one place a malformed or
    ;; hand-written `extends` edge would hang the program instead of reporting, and a reflection
    ;; helper that can hang is worse than one that gives up.
    (fn ancestors [t <- Any] -> String[]
        (mut out <- String[] [])
        (mut cur <- Any t)
        (mut steps <- Int 0)
        (while (< steps 64) (
            (let e (parent-name cur))
            (if (== e "") (return out))
            (out.push e)
            (cur := (type-by-name e))
            (steps := (+ steps 1))
        ))
        (return out))

    ;; Is `t` this type, or a descendant of it? Compares by NAME, which is what the edges hold.
    (fn is-subtype-of [t <- Any base <- String] -> Boolean
        (if (== t.name base) (return #t))
        (for :each a :from (ancestors t) :then (
            (if (== a base) (return #t))
        ))
        (return #f))

    ;; -- lookups, which is where inheritance starts to matter ------------------------------------

    ;; A method DECLARED on this type, or nil. Does not walk -- see `find-method`.
    (fn find-own-method [t <- Any name <- String] -> Any
        (for :each m :from (methods t) :then (
            (if (== m.name name) (return m))
        ))
        (return nil))

    ;; A property DECLARED on this type, or nil.
    (fn find-own-property [t <- Any name <- String] -> Any
        (for :each p :from (properties t) :then (
            (if (== p.name name) (return p))
        ))
        (return nil))

    ;; A method declared on this type OR INHERITED, nearest declaration first. This is the one most
    ;; callers actually want: `(type-by-name "Dog")` does not list `speak`, because Animal declares
    ;; it, and a `has-method` that did not walk would answer #f for every inherited method.
    (fn find-method [t <- Any name <- String] -> Any
        (mut cur <- Any t)
        (mut steps <- Int 0)
        (while (< steps 64) (
            (let hit (find-own-method cur name))
            (if (!= hit nil) (return hit))
            (let e (parent-name cur))
            (if (== e "") (return nil))
            (cur := (type-by-name e))
            (steps := (+ steps 1))
        ))
        (return nil))

    (fn find-property [t <- Any name <- String] -> Any
        (mut cur <- Any t)
        (mut steps <- Int 0)
        (while (< steps 64) (
            (let hit (find-own-property cur name))
            (if (!= hit nil) (return hit))
            (let e (parent-name cur))
            (if (== e "") (return nil))
            (cur := (type-by-name e))
            (steps := (+ steps 1))
        ))
        (return nil))

    (fn has-method [t <- Any name <- String] -> Boolean
        (return (!= (find-method t name) nil)))

    (fn has-property [t <- Any name <- String] -> Boolean
        (return (!= (find-property t name) nil)))

    ;; Every method name visible on this type, inherited included, nearest declaration first. An
    ;; override is listed ONCE, at the point that wins.
    (fn all-method-names [t <- Any] -> String[]
        (mut out <- String[] [])
        (mut cur <- Any t)
        (mut steps <- Int 0)
        (while (< steps 64) (
            (for :each m :from (methods cur) :then (
                (if (== (out.includes m.name) #f) (out.push m.name))
            ))
            (let e (parent-name cur))
            (if (== e "") (return out))
            (cur := (type-by-name e))
            (steps := (+ steps 1))
        ))
        (return out))

    (fn all-property-names [t <- Any] -> String[]
        (mut out <- String[] [])
        (mut cur <- Any t)
        (mut steps <- Int 0)
        (while (< steps 64) (
            (for :each p :from (properties cur) :then (
                (if (== (out.includes p.name) #f) (out.push p.name))
            ))
            (let e (parent-name cur))
            (if (== e "") (return out))
            (cur := (type-by-name e))
            (steps := (+ steps 1))
        ))
        (return out))

    ;; -- a method's own shape --------------------------------------------------------------------
    ;;
    ;; A method entry is `{name, params, returns}`, so it takes the same accessors as a function
    ;; descriptor -- `params`, `param-names`, `arity`, `returns` all work on one unchanged.

    ;; A parameter's declared type, as a rendered type string.
    (fn param-type [p <- Any] -> String
        (let t p.type)
        (if (== t nil) (return "Any"))
        (return t))

    (export
        name-of kind-of
        type-name type-kind
        is-class is-struct is-interface is-function is-primitive is-container
        properties methods params returns ctor-params required-count generics interfaces arity
        property-names method-names param-names
        parent-name parent ancestors is-subtype-of
        find-own-method find-own-property find-method find-property
        has-method has-property all-method-names all-property-names
        param-type)
)

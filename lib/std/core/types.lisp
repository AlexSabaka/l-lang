;; std/core/types -- the everyday type questions, answered PORTABLY.
;;
;; This module used to be three host spellings in a trench coat. `is-array` was `Array.isArray`,
;; `is-int` was `(== (typeof x) "bigint")`, and the rest went through a `get-type` helper reading
;; `x.constructor.name`. All three are JavaScript, so the whole module worked on exactly one backend
;; -- and nothing noticed, because everything under `lib/` is compiled and only ever run by the JS
;; suite.
;;
;; Each is now one question to the reflection floor: `(type x)` names a value from its
;; REPRESENTATION, and both backends answer identically (D54, amended Lb). Three host APIs became one
;; language primitive, and the module became portable without a line of backend work.
;;
;; -----------------------------------------------------------------------------------------------
;; WHY THIS CALLS THE FLOOR DIRECTLY INSTEAD OF IMPORTING `std/llang/reflect`.
;;
;; That module answers the same first question -- it has `name-of` and `kind-of` over the same
;; `(type x)` -- so importing it would save two lines here. Not worth a dependency: it is the RICH
;; surface (walking `extends`, listing methods, finding an inherited member, all of which needs
;; totality helpers and a graph walk), while this module asks one thing and asks it constantly.
;;
;; What is duplicated is two field reads. What must NOT be duplicated -- the DECISION about what a
;; value's type is called -- is in neither file: it is in the floor's shared metadata builder, which
;; both read. That is what A-0 asks for. Two callers of one primitive are not two implementations of
;; one decision.

;; Type aliases. `Number` is the one with reach: `(fn f [x <- Number])` takes either arm of the
;; numeric tower, and `lib/std/math` annotates nearly everything with it.
(deftype Number <- Int | Real)
(deftype Bool <- Boolean)
(deftype Str <- String)

;; Common data structures.
;;
;; `List` was `<- Array` and `Dict` was `<- Object` -- two JS-isms in the module whose whole header is
;; the story of removing JS-isms, and BOTH WERE BROKEN, not merely unused. Measured:
;;
;;     (let l <- List [1 2])     LL0200 cannot assign Int[] to List
;;     (let d <- Dict {"a" 1})   LL0200 cannot assign Map to Dict
;;
;; `Any[]` is the array type the language actually has, and it works. `Dict` IS DELETED rather than
;; repointed at `Map`, because a `Map`-based `deftype` is unusable in both positions today --
;; `(let d <- D <- Map ...)` is LL0200 and `(f {"a" 1})` against a `D` parameter is LL0203. Shipping
;; `Dict <- Map` would have replaced a wrong alias with an unusable one. The gap is general (it hits
;; any user writing `deftype MyMap <- Map`) and is recorded in docs/roadmap.md; `Dict` comes back when
;; it closes. Zero call sites either way.
(deftype List <- Any[])

(export Number Bool Str List
        type-name type-kind
        is-nil is-int is-real is-number is-string is-bool is-array is-map
        is-function is-instance)

;; -- naming a value --------------------------------------------------------------------------------

;; The type NAME of any value: "Int" "Real" "String" "Boolean" "Nil" "Array" "Map" "Function", or a
;; class's own name.
;;
;; This used to map a JS constructor name through a `match`, which is why it answered "Float" for a
;; Real -- a name from no specification, belonging to no l-lang type, reachable only because the table
;; was written against `typeof` rather than against the language. It also answered "Object" for a map
;; AND for a class instance, so the two were not distinguishable at all.
(fn type-name [x <- Any] -> String
  (let t (type x))
  (return t.name))

;; The KIND of a value's type: "primitive", "container", "class", "struct", "interface", "function",
;; or "unknown".
(fn type-kind [x <- Any] -> String
  (let t (type x))
  (return t.kind))

;; -- the predicates --------------------------------------------------------------------------------

;; D9: one bottom value. `==` against nil catches BOTH representations -- the `null` l-lang emits and
;; the `undefined` a JS library hands back -- so this stays a direct comparison rather than a
;; reflection call. It is also the one predicate that should not route through `(type x)`: cheaper,
;; and exact regardless of what the graph is willing to say about nil.
(fn is-nil [x <- Any] -> Boolean (return (== x nil)))

;; Int and Real are genuinely distinguishable now, on both backends -- D51's doing. An Int is an
;; int64 (a BigInt on the JS backend), so the two stopped being one host number, and the old
;; `Number.isInteger` spelling stopped being the best answer available: it called `5.0` an Int,
;; because f64 cannot tell an integral Real from an integer, and it called every BigInt not one.
(fn is-int [x <- Any] -> Boolean (return (== (type-name x) "Int")))
(fn is-real [x <- Any] -> Boolean (return (== (type-name x) "Real")))
(fn is-number [x <- Any] -> Boolean (return (or (is-int x) (is-real x))))

(fn is-string [x <- Any] -> Boolean (return (== (type-name x) "String")))
(fn is-bool [x <- Any] -> Boolean (return (== (type-name x) "Boolean")))

;; A container answers its own name now, not the host's word for it. `is-map` could not have existed
;; before: a map and a class instance were both "Object" on the JS backend, so the question had no
;; answer to give.
(fn is-array [x <- Any] -> Boolean (return (== (type-name x) "Array")))
(fn is-map [x <- Any] -> Boolean (return (== (type-name x) "Map")))

;; By KIND, not by name -- a DECLARED function reflects to its own name ("add"), and only an anonymous
;; one answers "Function". The kind is what the two have in common.
(fn is-function [x <- Any] -> Boolean (return (== (type-kind x) "function")))
(fn is-instance [x <- Any] -> Boolean (return (== (type-kind x) "class")))

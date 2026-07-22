;; ADVERSARIAL (parity guard): what `(type v)` ANSWERS for a value, on both backends.
;;
;; `reflection_metadata_depth` next door pins how DEEP the graph goes for a declared class or
;; function. This pins the other half, which had no guard at all: the NAME and KIND `(type v)` gives
;; for a value the metadata graph does not describe -- a primitive, nil, a container, a lambda. Every
;; one of those reached a per-backend FALLBACK, and the fallbacks are where two runtimes are least
;; alike. Measured before the fix, five of the eleven lines below disagreed:
;;
;;   (type <dynamic String>)  JS "Unknown"/unknown     C "String"/primitive
;;   (type nil)               JS nil (!)               C "Nil"/unknown
;;   (type [1 2 3])           JS "Array"/object        C "Array"/unknown
;;   (type {:a 1})            JS "Object"/object       C "Map"/unknown
;;   (type <lambda>)          JS "f"/class             C "Function"/unknown
;;   (type add)               JS add's full metadata   C "Function"/unknown
;;
;; Three separate causes, one shape: a name nobody had decided. `Nil`, `Array`, `Map` and `Function`
;; were in no table, so each backend invented an answer -- JS from the HOST (`Object` is JS's name for
;; a map, and `Object.keys` supplied a map's own keys as its "properties"), C from a bare `{kind:
;; "unknown"}` stub. The names are now seeded in the ONE shared builder (reflection/metadata.ts), which
;; is where a decision both backends make is supposed to live (A-0/D50), and both simply find them.
;;
;; Reported as `name/kind` strings rather than whole-object dumps DELIBERATELY: this guard is about
;; the ANSWER, and printing the descriptors would make it a second copy of the display-format guard
;; (D55 3.5) that fails for wrapping reasons having nothing to do with reflection.
(
    (fn add [a <- Int b <- Int] -> Int
        (return (+ a b)))

    (defclass Point
        (mut :ctor x <- Int)
        (mut :ctor y <- Int))

    (defclass Point3 :extends Point
        (mut :ctor z <- Int))

    ;; `v` is an Any PARAMETER, so the compile-time fold cannot fire and every line below is answered
    ;; by the runtime -- which is the half that was diverging.
    (fn describe [v <- Any] -> String
        (let t (type v))
        (return '"{t.name}/{t.kind}"))

    (console.log "string:  " (describe "hi"))
    (console.log "int:     " (describe 7))
    (console.log "real:    " (describe 2.5))
    (console.log "boolean: " (describe #t))
    (console.log "nil:     " (describe nil))
    (console.log "array:   " (describe [1 2 3]))
    (console.log "map:     " (describe {:a 1 :b 2}))
    (console.log "instance:" (describe (Point 3 4)))
    (console.log "function:" (describe add))
    (console.log "lambda:  " (describe (fn [x <- Int] -> Int (return x))))

    ;; A container's ELEMENTS are not its properties. JS answered `properties: ["0" "1" "2"]` for the
    ;; array and `["a" "b"]` for the map -- `Object.keys` showing through the way `null` did before
    ;; D55. A container has no properties on either backend now, so this is nil on both (a dotted read
    ;; of an absent key is the D9 TOTAL accessor; the indexer is the partial one that throws).
    (let arr-t (type [1 2 3]))
    (console.log "array props:" arr-t.properties)

    ;; The graph is still WALKABLE -- `extends` is a NAME, so climbing is a by-name lookup. This is
    ;; the one place the seeded entries could have broken something: `Point3`'s parent must still
    ;; resolve to the real `Point`, not to a seed.
    ;;
    ;; Walked with the INDEXER, not `p3.extends`, and that is not a style choice: the dotted read is
    ;; broken on JS for this exact key. `extends` is a JS reserved word, the emitter runs every member
    ;; name through the same encoder it uses for bindings, and the read comes out `p3._extends` -- a
    ;; key that is not there, answering nil. See `reserved_word_map_keys.lisp`, which pins it.
    (let p3 (type (Point3 1 2 3)))
    (let parent (type-by-name p3["extends"]))
    (console.log "parent:  " '"{parent.name}/{parent.kind}"))

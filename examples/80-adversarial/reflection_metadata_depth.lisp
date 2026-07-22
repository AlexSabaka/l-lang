;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): reflection metadata DEPTH
;; (parity §5.2 cluster 3, c-backend-gap-ledger).
;;
;; `type` (reflect a value) and `type-by-name` (look a name up) return a DEEP metadata object on the JS
;; backend, built from the symbol table: a function reports `{name, kind, params:[{name,type}], returns,
;; nullable}`; a class reports `{name, kind, properties, methods, ...}`. The C runtime carries only
;; `name` + `parent` on `ll_class`, so `ll_type`/`ll_class_meta`/`ll_type_by_name` can emit at most
;; `{ name, extends }` -- and have NO function arm at all, so `type-by-name` of a function returns nil.
;; The field/param/method graph is never emitted into the C module, so the runtime physically cannot
;; deepen it. EXPECTED == golden (the full graph, in l-lang's own notation -- FLOOR.md 3.5). Note the
;; golden no longer contains node's `[Object]`/`[Array]` depth-2 truncation: D55 rules ONE depth
;; policy, unlimited, so the constructor params and nested method params are visible at last.
;; ACTUAL under C: a shallow stub.
;; Whole-object dumps (matching examples/07-types/01) so the full depth is what the guard pins.
(
    (fn add [a <- Int b <- Int] -> Int
        (return (+ a b)))

    (defclass Point
        (mut :ctor x <- Int)
        (mut :ctor y <- Int)
        (fn norm [] -> Int (return (+ this.x this.y))))

    (let p (Point 3 4))

    (console.log "fn:" (type-by-name "add"))   ;; JS: full {name,kind,params,returns,nullable} | C: nil
    (console.log "prim:" (type 5))             ;; JS: {name:'Int',kind:'primitive',nullable}    | C: {name,extends}
    (console.log "class:" (type p))            ;; JS: full {name,kind,properties,methods,...}   | C: {name,extends}
)

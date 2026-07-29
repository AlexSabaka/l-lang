;; ADVERSARIAL: WHAT A LIFTED BODY CAN STILL SEE.
;;
;; The JS backend closes over module scope for free. A C function cannot see `main`'s locals, so
;; `computeGlobals` hoists every module-level binding that a top-level function READS into a file-scope
;; global. It scanned `items` for `_type === "function"` -- and a `defmodifier` is not one. It is a
;; `modifier-def` HOLDING a function.
;;
;; D75 unfolds that held function into a top-level C function, so a module-level binding it reads faces
;; exactly the obstruction the pass exists for. Measured before the fix:
;;
;;     cc: error: use of undeclared identifier 'u_prefix'
;;
;; and correct on JS, which is the usual shape of a C-only gap. The workaround on record was "call a
;; top-level FUNCTION instead, one hop is the whole fix" -- true, and unnecessary: the scan was simply
;; not looking in the one place D75 puts a function body.
(
    (let prefix "[audit]")
    (let limit 2)

    ;; -- the WRAPPER reads two module-level bindings --------------------------------------------------
    ;;
    ;; Two, and of different types, because the hoist carries the binding's ctype: a `str` and an `int`
    ;; land on different C declarations, and a scan that found one could still miss the other.

    (defmodifier audited []
        (fn [original ...args]
            (console.log prefix "call with" args.length "of" limit)
            (original ...args)))

    (fn work [n <- Int] -> Int (* n 2))
    (fn :audited twice [n <- Int] -> Int (* n 2))
    (console.log "undecorated:" (work 21))
    (console.log "decorated  :" (twice 21))

    ;; -- and the SETUP slot reads one too ------------------------------------------------------------
    ;;
    ;; The setup is hoisted to its own global and initialised before the module body runs, so it can
    ;; read a module binding only if that binding is ALSO a global by then. Same scan, second consumer.

    (defmodifier tagged []
        (let seen {})
        (fn [original n]
            (seen[prefix] := n)
            (console.log "setup saw" seen[prefix] "under" prefix)
            (original n)))

    (fn thrice [n <- Int] -> Int (* n 3))
    (fn :tagged tripled [n <- Int] -> Int (* n 3))
    (console.log "undecorated:" (thrice 5))
    (console.log "decorated  :" (tripled 5))

    ;; -- A DIFFERENT ROOT CAUSE, verified here because nothing else in the corpus does it -------------
    ;;
    ;; A class field DEFAULTING to a map literal was `ELL0106 'map': no lowering exists`, and a vector
    ;; default in the same position was fine. That is not about module scope at all -- it is the same
    ;; missing `map` case in `resolveAstExpr` that refused an imported module-level map literal and the
    ;; decorator setup slot. Three unrelated reports, one absent switch arm; this is the third, and it
    ;; had no guard anywhere.

    (defclass Registry
        (let :ctor tag)
        (mut items {})
        (mut names []))
    (let r (new Registry "reg"))
    (r.items["k"] := 7)
    (console.log "field map  :" r.tag r.items["k"] r.names.length)
    (console.log "done")
)

;; ADVERSARIAL (parity guard): `std/core/types` answers on BOTH backends.
;;
;; It did not, and nothing said so. `is-array` was `Array.isArray`, `is-int` was `(== (typeof x)
;; "bigint")`, and `is-string`/`is-bool`/`type-name` all went through a helper reading
;; `x.constructor.name`. Three JavaScript spellings, so the module worked on one backend -- and the
;; corpus never caught it, because everything under `lib/` is marked `library`: compiled, never run.
;; `16-stdlib/test_stdlib.lisp` does exercise these, and it has never passed on C for other reasons,
;; so the one file that would have noticed was already red.
;;
;; Rewritten onto `(type x)`, which names a value from its REPRESENTATION and answers identically on
;; both backends (D54, amended Lb). This guard is the proof, and it deliberately includes the two
;; discriminations that were IMPOSSIBLE before rather than merely non-portable:
;;
;;   a map vs a class instance -- both answered "Object" on JS, JavaScript's word for both;
;;   an Int vs an integral Real -- one host number until D51 made an Int a BigInt.
;;
;; Both are the same failure the reflection convergence found everywhere else: the host's names
;; showing through where the language has its own.

(import "std/core/types")

(defclass Point
    (mut :ctor x <- Int)
    (mut :ctor y <- Int))

(fn add [a <- Int b <- Int] -> Int (return (+ a b)))

(
    (console.log "--- type-name ---")
    (console.log "int:     " (type-name 5))
    (console.log "real:    " (type-name 2.5))
    (console.log "string:  " (type-name "s"))
    (console.log "boolean: " (type-name #t))
    (console.log "nil:     " (type-name nil))
    (console.log "array:   " (type-name [1 2 3]))
    (console.log "map:     " (type-name {:a 1}))
    (console.log "instance:" (type-name (Point 1 2)))
    (console.log "function:" (type-name add))

    (console.log "--- Int vs Real ---")
    ;; The pair the old `Number.isInteger` spelling got wrong in BOTH directions: it called an
    ;; integral Real an Int, because f64 cannot tell them apart, and it called every actual Int
    ;; (a BigInt after D51) not one.
    (console.log "is-int 5:    " (is-int 5))
    (console.log "is-int 5.0:  " (is-int 5.0))
    (console.log "is-real 5.0: " (is-real 5.0))
    (console.log "is-number 5: " (is-number 5))

    (console.log "--- map vs instance ---")
    ;; Unanswerable before: both were "Object".
    (console.log "map is-map:       " (is-map {:a 1}))
    (console.log "map is-array:     " (is-array {:a 1}))
    (console.log "map is-instance:  " (is-instance {:a 1}))
    (console.log "point is-instance:" (is-instance (Point 1 2)))
    (console.log "point is-map:     " (is-map (Point 1 2)))

    (console.log "--- the rest ---")
    (console.log "is-string:  " (is-string "s") (is-string 5))
    (console.log "is-bool:    " (is-bool #t) (is-bool "t"))
    (console.log "is-array:   " (is-array [1 2]) (is-array "no"))
    (console.log "is-nil:     " (is-nil nil) (is-nil 0))
    (console.log "is-function:" (is-function add) (is-function 5)))

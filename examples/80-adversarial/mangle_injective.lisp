;; ADVERSARIAL: two distinct source names must never become one C identifier.
;;
;; `mangleC` escaped each character outside `[A-Za-z0-9_]` to `_<hex>` and let `_` through untouched,
;; so the escape was not self-delimiting:
;;
;;     a-b     ->  u_a + _2d + b  =  u_a_2db
;;     a_2db   ->  u_a_2db
;;
;; Two bindings, one C identifier. It surfaced two ways, and the second is the one that matters:
;;
;;   * as a HARD FAILURE -- `cc: error: redefinition of 'u_a_2db'`, no binary produced;
;;   * as a SILENT WRONG ANSWER -- when one of the two is a PARAMETER, it does not redefine the
;;     global, it SHADOWS it, and the program runs and prints the wrong number with no diagnostic
;;     anywhere. That shape is section 2 below, and it answered 10 where JS answered 116.
;;
;; THE SAME DEFECT IN THE METHOD-NAME JOIN. `__ll_method_<class>_<method>` is reachable two ways --
;; class `Foo` with method `bar_baz`, and class `Foo_bar` with method `baz` -- because either part
;; could contain the `_` used as the separator. One fix closes both: with `_` escaped, neither part can
;; produce a lone `_`, so the separator is unambiguous.
;;
;; WHY A TERMINATOR AND NOT JUST ESCAPING `_`. Escaping the underscore alone still leaves a second,
;; independent collision, because a codepoint's hex is VARIABLE-LENGTH:
;;
;;     x-ac    ->  x + _2d + ac   =  x_2dac        (`-` is U+002D, two hex digits)
;;     xⶬ      ->  x + _2dac      =  x_2dac        (`ⶬ` is U+2DAC, four)
;;
;; Non-ASCII identifiers do lex, so that pair is reachable rather than theoretical. It is NOT executed
;; here: the JS backend has the identical collision and emits `const x2dac` twice, a syntax error, so
;; the file could not pass on both backends. C answers `10 20` correctly today. Logged with the other
;; "C right, oracle wrong" cases waiting on a way to pin them (roadmap, Known gaps).
;;
;; So: `_` doubles to `__`, everything else becomes `_<hex>_`. A `_` is followed by either another `_`
;; (a literal underscore) or by at least one hex digit and a closing `_` (an escape), and a hex digit
;; is never `_` -- so the two cases are told apart by the second character alone.
(
    ;; -- 1. the pair that collided, as two ordinary bindings ----------------------------------------
    ;;
    ;; This is the `cc` redefinition shape: both are module-level, so the second `int64_t u_a_2db`
    ;; landed beside the first and the compile died before anything ran.

    (let a-b 111)
    (let a_2db 222)
    (console.log "two globals:" a-b a_2db)

    ;; -- 2. the SILENT one: a parameter shadowing a global it collided with -------------------------
    ;;
    ;; `a-b` is the global above; `a_2db` is this function's parameter. They mangled to one name, so
    ;; inside the body BOTH spellings read the parameter and `(+ a-b a_2db)` computed `(+ 5 5)`.
    ;; Nothing redefined anything, nothing was diagnosed, and the answer was 10 instead of 116.

    (fn add-global [a_2db <- Int] -> Int (return (+ a-b a_2db)))
    (console.log "shadowed:  " (add-global 5))

    ;; -- 3. the method-name JOIN -------------------------------------------------------------------
    ;;
    ;; Neither class name nor method name contains anything the old escape would have touched -- the
    ;; collision is purely in the JOIN, which is why escaping alone had to be paired with the
    ;; separator argument above.

    (defclass Foo
        (fn bar_baz [] -> String (return "Foo.bar_baz")))

    (defclass Foo_bar
        (fn baz [] -> String (return "Foo_bar.baz")))

    (let f (Foo))
    (let g (Foo_bar))
    (console.log "join:      " (f.bar_baz) (g.baz))

    ;; -- 4. the ordinary kebab name still works ----------------------------------------------------
    ;;
    ;; The escape got longer, so this is the guard that it did not get WRONG: a hyphenated name is the
    ;; overwhelmingly common case and has to keep resolving to itself.

    (fn get-area [w <- Int h <- Int] -> Int (return (* w h)))
    (let first-name "Ada")
    (console.log "kebab:     " (get-area 3 4) first-name)

    ;; -- 5. a literal underscore, which now doubles -------------------------------------------------
    ;;
    ;; `_` is no longer a pass-through character, so plain snake_case names go through the new branch.
    ;; They must still be distinct from each other and from their kebab twins.

    (let snake_case 1)
    (let snake-case 2)
    (let _leading 3)
    (let trailing_ 4)
    (console.log "underscore:" snake_case snake-case _leading trailing_)
)

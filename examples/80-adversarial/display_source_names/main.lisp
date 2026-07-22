;; CONFORMANCE guard: a value displays under its SOURCE name (D55 / FLOOR.md 3.5).
;;
;; The formatter's JS half read HOST reflection where its C half read l-lang's own metadata, in three
;; places. `display_imported_class_tag/` already forbids exactly this for a class TAG; these are the
;; sibling arms of the same switch, and they were never covered.
;;
;;   FIELD NAMES.   D21 makes kebab-case idiomatic and `encodeIdentifier` turns every character JS
;;                  rejects into its hex code, so `first-name` is the property `first2dname`. The
;;                  object arm enumerated `Object.keys(v)` and printed `Rec{:first2dname "Ada"}`
;;                  against C's `Rec{:first-name "Ada"}`. The mangled key passed the ident-like test
;;                  cleanly, so nothing downstream flagged it. The map is carried on the constructor
;;                  (`__ll_fields`) rather than decoded, because the encoding is NOT reversible:
;;                  `a2db` encodes `a-b` and is also a legal source name in its own right.
;;
;;   FUNCTION NAMES. `#<fn ...>` came from `Function.name`, i.e. the JS binding. A kebab-case function
;;                  printed `#<fn my2dkebab2dfn>`, and an IMPORTED one printed
;;                  `#<fn __ll_inlined__double_1>` -- a mangler symbol that appears nowhere in the
;;                  user's source and changes with unrelated edits to the module graph. Both now carry
;;                  `__ll_name`, read first, with the host name kept as a fallback for the unstamped
;;                  cases (a nested `fn` whose ASCII name needed no encoding is already correct).
;;
;; The all-ASCII single-word cases that the corpus already had -- `01_closures.expect`'s
;; `#<fn increment>`, `display_conformance.lisp`'s `Tagged{:label ...}` -- cannot discriminate any of
;; this: the encoded name, the host name and the source name all coincide there.
(
    (import "./lib")

    (defstruct Rec
        (let :ctor first-name <- String "")
        (let :ctor last-name <- String "")
    )

    (fn my-kebab-fn [x <- Int] -> Int (* x 2))

    ;; Fields: kebab-cased, and nested so the object arm is exercised below the top level too.
    (console.log (Rec "Ada" "Lovelace"))
    (console.log [(Rec "Ada" "Lovelace")])

    ;; A same-module function whose name needs encoding.
    (console.log my-kebab-fn)

    ;; An IMPORTED function -- the binding here is `__ll_inlined_*`.
    (console.log double-it)
    (console.log [double-it])

    ;; A field READ through the kebab name still works -- the encoding is only a display concern.
    ;; Bound first: `(expr).field` does not chain (a method suffix does), flagged in Ff-3.
    (let r (Rec "Ada" "Lovelace"))
    (console.log r.first-name)
)

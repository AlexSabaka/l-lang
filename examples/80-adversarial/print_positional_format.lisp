;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): std/io `print` positional `{N}` format
;; (parity §5.2 cluster 1, c-backend-gap-ledger).
;;
;; `print` is an l-lang LIBRARY fn (lib/std/io/io.lisp): its body substitutes each `{index}` with the
;; matching positional arg, then `console.log`s the result. On JS the imported body is inlined, so the
;; substitution runs. The C backend maps `print` STRAIGHT to the `ll_console_log` intrinsic (a plain
;; space-join), so it never sees io.lisp's body -- the template prints LITERALLY with the args appended
;; (`x={0} 5` instead of `x=5`). EXPECTED == golden (the JS output below). ACTUAL under C: each line is
;; the raw `{N}` template + space-joined args. A guard for the day the C `print` binds std/io's body.
;;
;; Note two substitution edges the library body itself has, exercised here so the golden pins them:
;; `str.replace` with a string needle replaces only the FIRST match, and a `{N}` with no Nth arg is
;; left untouched.
(
    (import "std/io")

    (print "x={0}" 5)          ;; single placeholder            | C: x={0} 5
    (print "{0}{1}" "a" "b")   ;; adjacent placeholders          | C: {0}{1} a b
    (print "{1} {0}" "a" "b")  ;; reordered indices              | C: {1} {0} a b
    (print "{0} {0}" "x")      ;; repeated -> first-match only    | C: {0} {0} x
    (print "{0} {1}" "only")   ;; missing arg -> {1} stays literal| C: {0} {1} only
)

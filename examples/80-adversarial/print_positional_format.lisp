;; ADVERSARIAL (parity guard -- JS-correct, C-divergent): std/io `print` positional `{N}` format
;; (parity §5.2 cluster 1, c-backend-gap-ledger). Now also the conformance test for FLOOR.md §3.6.
;;
;; `print` is an l-lang LIBRARY fn (lib/std/io/io.lisp): it scans its template once and substitutes
;; each `{index}` with the matching positional arg, then `console.log`s the result. On JS the imported
;; body is inlined, so the scan runs. The C backend maps `print` STRAIGHT to the `ll_console_log`
;; intrinsic (a plain space-join), so it never sees io.lisp's body -- the template prints LITERALLY
;; with the args appended (`x={0} 5` instead of `x=5`). EXPECTED == golden (the JS output below).
;; ACTUAL under C: each line is the raw `{N}` template + space-joined args. A guard for the day the
;; C `print` binds std/io's body.
;;
;; The golden below is HAND-DERIVED from FLOOR.md §3.6, not captured from a run: under D55 neither
;; backend is the oracle for display, both are implementations of the written rule.
(
    (import "std/io")

    (print "x={0}" 5)          ;; one placeholder                      | C: x={0} 5
    (print "{0}{1}" "a" "b")   ;; adjacent placeholders                | C: {0}{1} a b
    (print "{1} {0}" "a" "b")  ;; reordered indices                    | C: {1} {0} a b

    ;; SUBSTITUTE-ALL. This printed `x {0}` until the scanner replaced the old arg-loop, which used
    ;; `str.replace` with a string needle -- JS first-match-only semantics leaking into the library.
    (print "{0} {0}" "x")      ;; repeated index -> BOTH substituted    | C: {0} {0} x

    ;; `{{` and `}}` are the escapes. `{{0}}` is a literal `{`, then `0`, then a literal `}` -- it is
    ;; NOT a placeholder, so the trailing argument goes unused (C# allows extra arguments).
    (print "{{0}} stays" 9)    ;; escaped braces                        | C: {{0}} stays 9
    (print "a}}b")             ;; a bare doubled close                  | C: a}}b

    ;; DOCUMENTED DEVIATION from C#: a LONE `}` is emitted verbatim rather than throwing. Only `{`
    ;; opens a placeholder, so there is nothing ambiguous to reject.
    (print "50% } done")       ;; lone close brace                      | C: 50% } done

    ;; A placeholder whose index has no argument THROWS (C#'s FormatException). Caught here so the
    ;; program still terminates normally and the golden stays deterministic; the catch body prints a
    ;; FIXED literal rather than `e.message`, so this does not depend on error-object field shape.
    (try (
        (print "{0} {1}" "only")
    )
    catch e :of Error (
        (console.log "threw: missing argument")
    ))
)

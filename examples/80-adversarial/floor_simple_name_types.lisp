;; CONFORMANCE guard: the checker consults the intrinsic floor for SIMPLE names, not only dotted ones
;; (D50).
;;
;; `TypeEnvironment.resolveIdentifier` looked up `floorEntry(name)` inside the branch guarded by
;; `name.includes('.') || name.includes(':')`. A simple name never reached it, so **25 of the 48 floor
;; entries contributed no types at all** -- every `codepoint-*`, every `map-*`, `get`/`head`/`tail`/
;; `elem`/`empty`/`list`, `display`, `type`, `parseInt`, `isNaN`. The floor knew their signatures and
;; the C backend derived its runtime calls from them; the checker simply never asked.
;;
;; That is not cosmetic, because D49d decides DIVISION from the static types: `Int / Int` truncates,
;; and a `Real` operand promotes. With `codepoint-length`'s `-> Int` invisible, the quotient below is
;; Real-typed, and the two backends then disagree about what that means:
;;
;;     (/ (codepoint-length "abcde") 2)      JS 2      C 2.5      D49d says 2
;;
;; JS only printed 2 by accident -- the operands happen to be BigInts at runtime and BigInt division
;; truncates, so the generic `/` gave the right answer for the wrong reason. C emitted a genuine
;; double divide. Annotating `(let n <- Int (codepoint-length s))` made both answer 2, which is what
;; pinned the missing input to the CHECKER rather than to either runtime.
;;
;; `lib/std/string` and `lib/std/seq` annotate every floor result they bind, so the standard library
;; masked this completely. Only user code that writes the natural expression hits it.
;;
;; The shadowing rule this must not break: a user-defined or imported binding of the same name still
;; wins. The floor answers only where the symbol table has nothing, or has an UNTYPED extern -- the
;; same rule the dotted branch has always applied to its base ("anything that gives the base a real
;; type is a different thing that happens to share a spelling, and wins"). The `head` section below is
;; the control for that.
(
    ;; Int / Int truncates (D49d). Each numerator's type comes only from the floor.
    (console.log "5 cp / 2:   " (/ (codepoint-length "abcde") 2))
    (console.log "7 cp / 3:   " (/ (codepoint-length "abcdefg") 3))

    ;; `codepoint-at` is `-> Int` too: "d" is 100, and 100/8 discriminates -- 12 truncated, 12.5 real.
    (console.log "cp .d. / 8: " (/ (codepoint-at "d" 0) 8))

    ;; A floor entry whose return type is a CONTAINER, reached by a simple name.
    (let m {})
    (map-set m "b" 2)
    (map-set m "a" 1)
    (console.log "map-keys:   " (map-keys m))

    ;; SHADOWING CONTROL, and it is the reason the fix cannot simply consult the floor first.
    ;; `empty` IS a floor entry (`ll_empty`, `Any -> Boolean`). Redefined here as `String -> String`,
    ;; the user's binding must win -- it already did on both backends before this change, and it has
    ;; to keep doing so, or widening the lookup would silently retype every program that names one of
    ;; the 25.
    (console.log "user empty: " (empty "xyz"))
)

(fn empty [s <- String] -> String (+ "<" (+ s ">")))

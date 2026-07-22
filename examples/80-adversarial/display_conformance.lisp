;; CONFORMANCE guard: the display formatter's four unguarded divergences (D55 / FLOOR.md 3.5).
;;
;; Fc implemented §3.5 twice -- `runtime/inspectJs.ts` and `runtime.c`'s `ll_inspect_*` -- on the
;; argument that two implementations of one written rule are kept in step by conformance guards. The
;; guards did not exist. All four of these were live, and every existing display golden was blind to
;; every one of them, because they are all about shapes the corpus never prints.
;;
;;   1. THE KEY TEST. Both sides invented their own "is this ident-like", and disagreed in BOTH
;;      directions: C allowed `$` and rejected `-`, JS the reverse, so `{"a-b" 1 :a$b 2}` on C was
;;      `{:a-b 1 "a$b" 2}` on JS. Neither matched the READER, which is the only thing §3.5 can mean
;;      by ident-like, since D55 rules this to be l-lang's own reader syntax. Both now transcribe the
;;      tokenizer's Identifier pattern from `frontend/grammar_v2/tokens.ts`:
;;
;;          a leading [a-zA-Z_ or U+0080..U+FFFF], then any of those plus digits and a hyphen.
;;
;;      (Spelled out rather than pasted: an l-lang ;; comment is carried into the emitted
;;      JavaScript as a BLOCK comment, so a comment containing the two characters that close
;;      one produces invalid output -- "ELL0101 ... not valid JavaScript". Flagged; the
;;      emitter should escape them.)
;;
;;      So `-` is in (D21's kebab-case is the whole point), `$` is out (it lexes as an OPERATOR in
;;      l-lang, not an identifier), a leading digit is out, and non-ASCII is IN -- which neither
;;      implementation had, and which the pattern has always permitted.
;;
;;   2. THE WIDTH BUDGET. C wrote the class tag straight to the output and measured only the braces,
;;      so a tagged instance was measured without its own name. The pair below straddles column 80 on
;;      purpose: `flat` fits at 80 with the tag counted, `wide` fits at 78 WITHOUT it and 82 with --
;;      so before this it stayed on one line here and broke on JS.
;;
;;   3. THE CYCLE SET. C's was a fixed 256 slots whose push silently did nothing once full, so a
;;      cycle nested deeper than that went undetected and the renderer recursed until the process
;;      died. `deep-cycle` closes a loop 300 levels down; it SEGFAULTED before.
;;
;;   4. (Guarded separately, in `display_imported_class_tag/`.) JS read `__ll_name` off the INSTANCE,
;;      where it is never present -- it is stamped static on the constructor -- and fell through to
;;      the mangled `constructor.name`.
;;
;; The `nested-display` line looks redundant next to the others and is not: `display` had its own
;; copy of the cycle-set setup, so when the set grew a heap pointer it was left uninitialized there
;; and `(display [[1] [2]])` segfaulted at nesting depth TWO. `console.log` renders through a
;; different entry point and was fine, which is exactly why a guard has to exercise `display` itself.
(
    (defstruct Tagged
        (let :ctor label <- String "")
    )

    ;; -- 1. the key test ---------------------------------------------------------------------------
    (let keys {})
    (keys["a-b"] := 1)      ;; kebab-case: ident-like
    (keys["a$b"] := 2)      ;; `$` is an operator character in l-lang: NOT ident-like
    (keys["ok_1"] := 3)     ;; underscore and a non-leading digit: ident-like
    (keys["9lead"] := 4)    ;; leading digit: NOT ident-like
    (keys["ключ"] := 5)     ;; non-ASCII: ident-like, per the tokenizer's own range
    (keys["two words"] := 6)
    (console.log "keys:" keys)

    ;; -- 2. the width budget -----------------------------------------------------------------------
    ;; `Tagged{:label "<N>"}` measures N + 17 columns with the tag and N + 11 without, so N in 64..69
    ;; is where the tag alone decides. 63: exactly 80 with the tag counted -- stays flat.
    (console.log (Tagged "000000000000000000000000000000000000000000000000000000000000000"))
    ;; 67: 78 columns without the tag, 84 with it. Must break -- and did not, before this.
    (console.log (Tagged "0000000000000000000000000000000000000000000000000000000000000000000"))

    ;; -- 2b. the width UNIT -------------------------------------------------------------------------
    ;;
    ;; The budget is a count of CHARACTERS. It was a count of BYTES on C (the flat form is built in an
    ;; ll_sb and `one.len` was its byte length) and of UTF-16 CODE UNITS on JS (`oneLine.length`), so
    ;; for the astral row below the three answers were 24 (the rule), 44 (JS) and 84 (C) -- neither
    ;; implementation counted what the rule counts, and the spec never stated the unit in a clause.
    ;;
    ;; The ASCII pair pins the boundary itself, where all three units agree: 80 columns stays flat,
    ;; 81 breaks. The two non-ASCII rows are 44 and 24 columns -- comfortably flat -- but 84 BYTES
    ;; each, so C broke both of them with room to spare.
    (console.log ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
    (console.log ["aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"])
    (console.log ["éééééééééééééééééééééééééééééééééééééééé"])
    (console.log ["😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀"])
    ;; A realistic one rather than a synthetic ladder: 54 columns flat, 87 bytes.
    (console.log {:msg "Привіт, світ! Це рядок українською мовою." :n 1})

    ;; -- 3. cycles ---------------------------------------------------------------------------------
    (let cyc [])
    (cyc.push 1)
    (cyc.push cyc)
    (console.log "cycle:" cyc)

    ;; A cycle far below C's old 256-entry cap. Measured, not printed -- the rendering is ~180KB, and
    ;; what is being pinned is that both backends produce the SAME one rather than one of them dying.
    (let root [])
    (mut cur <- Any[] root)
    (mut i <- Int 0)
    (while (< i 300) (
        (let child [])
        (cur.push child)
        (cur := child)
        (i := (+ i 1))
    ))
    (cur.push root)
    ;; Bound first: `(display root).length` does not chain -- a FIELD suffix on a parenthesized
    ;; expression parses as a separate identifier (a method suffix does chain). Flagged in Ff-3.
    (let rendered (display root))
    (console.log "deep-cycle:" rendered.length)

    ;; -- the `display` entry point itself ----------------------------------------------------------
    (console.log "nested-display:" (display [[1] [2]]))
)

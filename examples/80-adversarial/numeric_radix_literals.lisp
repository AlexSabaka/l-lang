;; ADVERSARIAL: a radix literal is an `Int` (D88).
;;
;; `0xFF` / `0o17` / `0b1010` lexed and evaluated correctly and had NO type-checker arm, so they
;; inferred **Unknown**. The gap ledger had been counting that for its whole life as
;; `A1:numeric-tower-literal` -- "channel types it Unknown, it is Int". An Unknown is assignable in
;; BOTH directions, so the literal was not merely untyped: it turned checking OFF at its use site.
;; `(let h <- String 0xFF)` compiled clean; it is `LL0200` now.
;;
;; ORACLE-DIVERGENT (D86), and not marginally: the JS backend cannot emit these AT ALL --
;; `ELL0100 visitHexNumber is not implemented in the JS backend`, likewise octal and binary. The
;; 2026-07-27 audit filed that as a C-backend defect ("divergent refusal frontier"); it is the
;; opposite, and D66 freezes the JS path. So this file is graded on C alone.
(
    ;; -- values, unchanged -------------------------------------------------------------------------
    ;;
    ;; Pinned because the fix is a TYPE change, and the guard that matters is that it moved no value.

    (console.log "hex:   " 0xFF)
    (console.log "octal: " 0o17)
    (console.log "binary:" 0b1010)

    ;; Separators (D71) still group in every radix.
    (console.log "grouped:" 0xDEAD_BEEF 0b1010_1010)

    ;; They are Int, so they take part in Int arithmetic rather than sitting in an Unknown that would
    ;; have accepted anything. `(let h <- String 0xFF)` is LL0200 now -- pinned in `test:diagnostics`,
    ;; where a compile error can be asserted without the file failing to run.
    (console.log "arith: " (+ 0xFF 1) (* 0b10 0o7))
)

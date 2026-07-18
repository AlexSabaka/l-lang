;; NEGATIVE: a hex literal parses but has NO JS emitter -> LL0100.
;; Representative of the whole numeric tower that both frontends lex but cannot lower:
;; hex (0xFF), octal (017), binary (0b1101), complex (3+4i), fraction (1/2) all fail the
;; same way (COVERAGE-MATRIX: *-number rows, all `no-emitter`). Pins LL0100, which had zero
;; test assertions. If a hex emitter ever lands, this flips red -- promote it to a positive
;; test then.
(
  (let x 0xFF)
  (console.log x)
)

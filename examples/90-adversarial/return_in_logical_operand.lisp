;; ADVERSARIAL: `return` inside a `||`/`&&` operand (finding CF1, l-lang-ex snake).
;;
;; `(|| false (return "early"))` must return "early" FROM f -- not wrap the operand in an
;; IIFE that swallows the return and lets the function fall through. This was silent-wrong
;; at the audit commit (f returned "fell-through"); FIXED at HEAD. Guards the whole
;; conditional-emission cluster (CF1/CF2/CF3) the audit flagged as highest-leverage.
(
  (fn f [] -> String
    (if (|| false (return "early")) (console.log "unreachable"))
    (return "fell-through"))
  (console.log (f))
)

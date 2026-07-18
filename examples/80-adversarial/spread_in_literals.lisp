;; ADVERSARIAL: spread in array literals and call args (finding CP1, l-lang-ex snake).
;;
;; The audit's headline silent bug: `[x ...xs]` used to compile to `__ll_copy(...xs)`,
;; dropping every element but the first (AF-002). FIXED at HEAD -- pins the fix so the
;; JS->LLVM backend split cannot silently reintroduce it. Spread is exercised in three
;; positions: prefix+spread, sole-spread, and call-argument.
(
  (let a [1 2 3])
  (console.log (JSON.stringify [0 ...a]))   ;; prefix then spread -> [0,1,2,3]
  (console.log (JSON.stringify [...a 4]))   ;; spread then suffix -> [1,2,3,4]
  (console.log (JSON.stringify [0 ...a 4])) ;; prefix, spread, suffix -> [0,1,2,3,4]
  (console.log (JSON.stringify [...a]))      ;; sole spread       -> [1,2,3]
  (console.log ...a)                          ;; call-arg spread   -> 1 2 3
)

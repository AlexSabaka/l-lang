;; ADVERSARIAL: spread in array literals and call args (finding CP1, l-lang-ex snake).
;;
;; The audit's headline silent bug: `[x ...xs]` used to compile to `__ll_copy(...xs)`,
;; dropping every element but the first (AF-002). FIXED at HEAD -- pins the fix so the
;; JS->LLVM backend split cannot silently reintroduce it. Spread is exercised in three
;; positions: prefix+spread, sole-spread, and call-argument.
;;
;; It renders through `std/text/json` rather than the host's `JSON.stringify`. That global is on no
;; floor, so this file -- which exists to stop a spread bug being reintroduced by the backend split --
;; could not run on C, which is precisely where the split would happen. The golden is UNCHANGED: it was
;; recorded from the host, and an l-lang renderer that reproduces it exactly is the evidence.
(
  (import "std/text/json")

  (let a [1 2 3])
  (console.log (to-json [0 ...a]))   ;; prefix then spread -> [0,1,2,3]
  (console.log (to-json [...a 4]))   ;; spread then suffix -> [1,2,3,4]
  (console.log (to-json [0 ...a 4])) ;; prefix, spread, suffix -> [0,1,2,3,4]
  (console.log (to-json [...a]))     ;; sole spread       -> [1,2,3]
  (console.log ...a)                 ;; call-arg spread   -> 1 2 3
)

;; NEGATIVE: a nondeterministic operation at compile time -> LL0099 (D73).
;;
;; A fold replaces an expression with the answer ONE PARTICULAR COMPILATION produced. For anything
;; nondeterministic that means the same source stops producing the same program: `Math.random` would
;; be a constant chosen once, at the compiler's whim, and then shipped in the artefact.
;;
;; The old `node:vm` evaluator could not have refused this. The sandbox simply had the host's `Math`
;; in scope, so `(let :comptime r (Math.random))` folded to a number and nothing anywhere noticed --
;; a reproducible-build hole that only closed once the compiler owned the evaluator.
;;
;; `Math.random` is still perfectly fine at RUN time. The refusal is about when it runs, not whether.
(
  (let :comptime r (Math.random))
  (console.log r)
)
